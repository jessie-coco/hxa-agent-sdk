import { io, type Socket } from 'socket.io-client'
import type {
  AgentSDKConfig,
  AgentContext,
  IncomingMessage,
  ConnectAck,
  MessageStatus,
  MessageSync,
  MessageSummary,
  TypingEvent,
  Logger,
  SendMessageParams,
  ResponseMode,
} from './types.js'

const DEFAULT_SOCKET_PATH = '/ws'
const DEFAULT_ACK_TIMEOUT_MS = 10_000
const MAX_RECONNECT_ATTEMPTS = 50
const DEFAULT_RESPONSE_MODE: ResponseMode = 'at_only'
const CONTEXT_WAIT_MS = 200
const CONTEXT_TTL_MS = 30_000
const PING_TIMEOUT_MS = 3_000

/**
 * AgentClient — Socket.IO client for agents connecting to HxA Link.
 *
 * Handles authentication via invite_token (hxal_ prefix), heartbeat management,
 * message sending/receiving, and automatic reconnection.
 */
export class AgentClient {
  private socket: Socket | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private contextCleanupTimer: ReturnType<typeof setInterval> | null = null
  private wsSessionToken: string | null = null
  private joinedConversations = new Set<string>()
  private readonly contextMap = new Map<string, { context: AgentContext; receivedAt: number }>()
  private readonly config: Required<Pick<AgentSDKConfig, 'autoReconnect' | 'socketPath'>> & AgentSDKConfig
  private readonly log: Logger
  private readonly filterEnabled: boolean

  constructor(config: AgentSDKConfig) {
    this.config = {
      autoReconnect: true,
      socketPath: DEFAULT_SOCKET_PATH,
      ...config,
    }
    if (!config.socketPath) {
      this.config.socketPath = AgentClient.deriveSocketPath(config.invitePackage.wsEndpoint)
    }
    this.log = config.logger ?? console
    this.filterEnabled = config.messageFilter?.enabled !== false
    if (config.sessionToken) {
      this.wsSessionToken = config.sessionToken
    }
  }

  /** Derive Socket.IO path from the wsEndpoint URL (strip trailing segments after /ws). */
  private static deriveSocketPath(wsEndpoint: string): string {
    try {
      const pathname = new URL(wsEndpoint).pathname
      const wsIdx = pathname.lastIndexOf('/ws')
      if (wsIdx >= 0) return pathname.substring(0, wsIdx + 3)
    } catch { /* invalid URL — fall through */ }
    return DEFAULT_SOCKET_PATH
  }

  /** Whether the socket is currently connected. */
  get isConnected(): boolean {
    return this.socket?.connected ?? false
  }

  /** The agent ID from the invite package. */
  get agentId(): string {
    return this.config.invitePackage.agentId
  }

  /** Current session token (for external persistence). */
  get sessionToken(): string | null {
    return this.wsSessionToken
  }

  /** HTTP base URL derived from wsEndpoint (e.g. `https://host/hxa-link-api`). */
  get apiBaseUrl(): string {
    const ep = this.config.invitePackage.wsEndpoint
    const parsed = new URL(ep)
    const origin = parsed.origin.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:')
    const apiBase = parsed.pathname.replace(/\/ws(\/.*)?$/, '')
    return `${origin}${apiBase}`
  }

  /**
   * Connect to the HxA Link WebSocket server.
   * Uses invite_token auth on first connect, wsSessionToken on reconnect.
   */
  connect(): void {
    if (this.socket?.connected) {
      this.log.warn('[ExternalAgent] Already connected')
      return
    }

    const { invitePackage, socketPath, autoReconnect } = this.config

    // Socket.IO needs just the origin — the path is set via the `path` option
    const baseUrl = new URL(invitePackage.wsEndpoint).origin

    const authPayload: Record<string, string> = this.wsSessionToken
      ? { wsSessionToken: this.wsSessionToken }
      : { credential: invitePackage.inviteToken }

    this.socket = io(baseUrl, {
      path: socketPath,
      auth: authPayload,
      transports: ['websocket'],
      reconnection: autoReconnect,
      reconnectionAttempts: autoReconnect ? MAX_RECONNECT_ATTEMPTS : 0,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
    })

    this.registerListeners()

    this.log.info(`[ExternalAgent] Connecting to ${baseUrl} (path: ${socketPath})...`)
  }

  /**
   * Disconnect from the server and clean up resources.
   */
  disconnect(): void {
    this.stopHeartbeat()
    this.stopContextCleanup()
    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.disconnect()
      this.socket = null
    }
    this.contextMap.clear()
    this.wsSessionToken = null
    this.log.info('[ExternalAgent] Disconnected')
  }

  /**
   * Send a message to a conversation.
   *
   * @returns Promise that resolves with the server's status acknowledgment.
   */
  sendMessage(params: SendMessageParams, timeoutMs = DEFAULT_ACK_TIMEOUT_MS): Promise<MessageStatus> {
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) {
        reject(new Error('Not connected'))
        return
      }

      const timer = setTimeout(() => {
        reject(new Error(`sendMessage timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      const payload = {
        conversationId: params.conversationId,
        type: params.type ?? 'text',
        content: params.content,
        clientMsgId: params.clientMsgId ?? crypto.randomUUID(),
        replyToId: params.replyToId,
      }

      this.socket.emit('message:send', payload, (response: MessageStatus) => {
        clearTimeout(timer)
        resolve(response)
      })
    })
  }

  /**
   * Send a typing indicator to a conversation.
   */
  sendTyping(conversationId: string, isTyping = true): void {
    if (!this.socket?.connected) {
      this.log.warn('[ExternalAgent] Cannot send typing — not connected')
      return
    }
    this.socket.emit('message:typing', { conversationId, isTyping })
  }

  /**
   * Join a conversation room for real-time message delivery.
   */
  joinConversation(conversationId: string, timeoutMs = DEFAULT_ACK_TIMEOUT_MS): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) {
        reject(new Error('Not connected'))
        return
      }
      const timer = setTimeout(() => {
        reject(new Error(`joinConversation timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.socket.emit('conversation:join', { conversationId }, (response: { success: boolean; error?: string }) => {
        clearTimeout(timer)
        resolve(response)
      })
    })
  }

  /**
   * Leave a conversation room.
   */
  leaveConversation(conversationId: string): void {
    if (!this.socket?.connected) return
    this.socket.emit('conversation:leave', { conversationId })
  }

  /**
   * Register a custom event handler on the underlying Socket.IO socket.
   * Use for platform-specific events not covered by the standard callbacks.
   */
  on(event: string, handler: (...args: unknown[]) => void): void {
    if (!this.socket) {
      throw new Error('Cannot register event handler before connect()')
    }
    this.socket.on(event, handler)
  }

  /**
   * Emit a custom event on the underlying Socket.IO socket.
   */
  emit(event: string, ...args: unknown[]): void {
    if (!this.socket?.connected) {
      this.log.warn(`[ExternalAgent] Cannot emit '${event}' — not connected`)
      return
    }
    this.socket.emit(event, ...args)
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private registerListeners(): void {
    const socket = this.socket!

    // ── Connection established ─────────────────────────────────────────────
    socket.on('connect_ack', (ack: ConnectAck) => {
      this.log.info(`[ExternalAgent] Connected as agent ${ack.agentId}`)
      this.wsSessionToken = ack.agentSessionToken
      this.startHeartbeat(ack.heartbeatInterval)
      if (this.filterEnabled) {
        this.startContextCleanup()
      }
      this.config.onSessionToken?.(ack.agentSessionToken)

      // #909: Auto-ping guardian verification
      this.pingGuardian(ack)
    })

    // ── Guardian pong (handled inline by pingGuardian timeout) ────────────
    socket.on('agent:pong', (data: { guardianNotified?: boolean }) => {
      this.log.info(`[ExternalAgent] Guardian pong received (notified: ${data?.guardianNotified ?? false})`)
    })

    // ── Agent context for group messages (arrives before message:new) ────
    socket.on('message:agent-context', (data: AgentContext) => {
      this.contextMap.set(data.messageId, { context: data, receivedAt: Date.now() })
      this.log.debug(`[ExternalAgent] agent-context for ${data.messageId}: responseMode=${data.responseMode}, isMentioned=${data.isMentioned}`)
    })

    // ── Incoming messages (broadcast from rooms.ts) ───────────────────────
    socket.on('message:new', (data: IncomingMessage | { message: IncomingMessage }) => {
      const message = 'message' in data && data.message ? data.message : data as IncomingMessage
      this.log.debug(`[ExternalAgent] message:new in ${message.conversationId} from ${message.senderId}`)

      if (!this.filterEnabled || !this.config.onMessage) {
        this.config.onMessage?.(message)
        return
      }

      // Own messages always pass through
      if (message.senderId === this.agentId) {
        this.config.onMessage(message)
        return
      }

      // Check if we already have context for this message
      const entry = this.contextMap.get(message.id)
      if (entry) {
        this.contextMap.delete(message.id)
        if (this.shouldDeliver(entry.context)) {
          this.config.onMessage(message)
        }
        return
      }

      // No context yet — could be a DM (no context will arrive) or context is slightly delayed.
      // Wait a short time, then check again.
      setTimeout(() => {
        const delayedEntry = this.contextMap.get(message.id)
        if (delayedEntry) {
          this.contextMap.delete(message.id)
          if (this.shouldDeliver(delayedEntry.context)) {
            this.config.onMessage!(message)
          }
        } else {
          // No context received — this is a DM or context was not sent. Always deliver.
          this.config.onMessage!(message)
        }
      }, CONTEXT_WAIT_MS)
    })

    // ── Message status updates ────────────────────────────────────────────
    socket.on('message:status', (status: MessageStatus) => {
      this.config.onMessageStatus?.(status)
    })

    // ── Message error ─────────────────────────────────────────────────────
    socket.on('message:error', (error: { clientMsgId?: string; error: string; retryAfterMs?: number }) => {
      this.log.error(`[ExternalAgent] message:error: ${error.error}`, error)
    })

    // ── Message summary (for unjoined conversations) ───────────────────────
    socket.on('message:summary', (data: MessageSummary) => {
      if (data.senderId === this.agentId) return

      if (!this.joinedConversations.has(data.conversationId)) {
        this.log.info(`[ExternalAgent] Summary for unjoined conv ${data.conversationId}, auto-joining`)
        socket.emit('conversation:join', { conversationId: data.conversationId }, (resp: { success: boolean; error?: string }) => {
          if (resp?.success) {
            this.joinedConversations.add(data.conversationId)
            this.log.info(`[ExternalAgent] Auto-joined conv ${data.conversationId}`)
          } else {
            this.log.warn(`[ExternalAgent] Auto-join failed for ${data.conversationId}: ${resp?.error}`)
          }
        })
      }

      this.config.onMessageSummary?.(data)
    })

    // ── Offline message sync (on reconnect) ───────────────────────────────
    socket.on('message:sync', (sync: MessageSync) => {
      this.log.info(`[ExternalAgent] Synced ${sync.count} offline messages (hasMore: ${sync.hasMore})`)

      const convIds = new Set(sync.messages.map(m => m.conversationId))
      for (const convId of convIds) {
        if (!this.joinedConversations.has(convId)) {
          socket.emit('conversation:join', { conversationId: convId }, (resp: { success: boolean; error?: string }) => {
            if (resp?.success) {
              this.joinedConversations.add(convId)
              this.log.info(`[ExternalAgent] Auto-joined conv ${convId} (from sync)`)
            }
          })
        }
      }

      this.config.onMessageSync?.(sync)
    })

    // ── Typing indicators ─────────────────────────────────────────────────
    socket.on('typing', (event: TypingEvent) => {
      this.config.onTyping?.(event)
    })

    // ── Session token renewal ─────────────────────────────────────────────
    socket.on('session:renewed', (data: { agentSessionToken: string }) => {
      this.wsSessionToken = data.agentSessionToken
      this.log.debug('[ExternalAgent] WS session token renewed')
      this.config.onSessionToken?.(data.agentSessionToken)
    })

    // ── Heartbeat ACK ─────────────────────────────────────────────────────
    socket.on('heartbeat_ack', (data: { serverTime?: number }) => {
      if (data?.serverTime) {
        const drift = Math.abs(Date.now() - data.serverTime)
        if (drift > 30_000) {
          this.log.warn(`[ExternalAgent] Clock drift detected: ${drift}ms`)
        }
      }
    })

    // ── Server disconnect warning (10s before disconnect) ───────────────
    socket.on('disconnect:warning', (data: { reason: string; disconnectInMs: number }) => {
      this.log.warn(`[ExternalAgent] Disconnect warning: ${data.reason} in ${data.disconnectInMs}ms`)
    })

    // ── Server-initiated disconnect reason ────────────────────────────────
    socket.on('disconnect:reason', (data: { code: string; message: string }) => {
      this.log.warn(`[ExternalAgent] Server disconnect: ${data.code} — ${data.message}`)
    })

    // ── Server error events ─────────────────────────────────────────────
    socket.on('error', (error: { message: string }) => {
      this.log.error(`[ExternalAgent] Server error: ${error.message}`)
    })

    // ── Socket.IO built-in events ─────────────────────────────────────────
    socket.on('connect', () => {
      this.log.info('[ExternalAgent] Socket.IO transport connected')
    })

    socket.on('disconnect', (reason: string) => {
      this.log.warn(`[ExternalAgent] Disconnected: ${reason}`)
      this.stopHeartbeat()
      this.stopContextCleanup()
      this.contextMap.clear()
      this.joinedConversations.clear()

      // Socket.IO does NOT auto-reconnect on server-initiated disconnect
      if (reason === 'io server disconnect' && this.config.autoReconnect) {
        const delay = 5000
        this.log.info(`[ExternalAgent] Server-initiated disconnect — retrying in ${delay / 1000}s`)
        setTimeout(() => {
          if (!this.socket?.connected) {
            this.log.info('[ExternalAgent] Manually reconnecting after server disconnect')
            this.socket?.connect()
          }
        }, delay)
      }

      this.config.onDisconnect?.(reason)
    })

    socket.on('connect_error', (error: Error) => {
      this.log.error(`[ExternalAgent] Connection error: ${error.message}`)
      if (this.wsSessionToken && /auth|SESSION|INVALID/i.test(error.message)) {
        this.log.info('[ExternalAgent] Clearing stale session token, will retry with invite token')
        this.wsSessionToken = null
        socket.auth = { credential: this.config.invitePackage.inviteToken }
      }
    })

    socket.io.on('reconnect', (attempt: number) => {
      this.log.info(`[ExternalAgent] Reconnected after ${attempt} attempt(s)`)
    })

    socket.io.on('reconnect_attempt', (attempt: number) => {
      this.log.debug(`[ExternalAgent] Reconnection attempt #${attempt}`)
      if (this.wsSessionToken) {
        socket.auth = { wsSessionToken: this.wsSessionToken }
      } else {
        socket.auth = { credential: this.config.invitePackage.inviteToken }
      }
    })

    socket.io.on('reconnect_failed', () => {
      this.log.error('[ExternalAgent] All reconnection attempts exhausted')
      this.config.onReconnectFailed?.()
    })
  }

  /**
   * Determine whether a message should be delivered based on its agent context.
   */
  private shouldDeliver(ctx: AgentContext): boolean {
    const mode: ResponseMode = ctx.responseMode ?? DEFAULT_RESPONSE_MODE
    switch (mode) {
      case 'all':
      case 'proactive':
        return true
      case 'silent':
        return false
      case 'at_only':
        return ctx.isMentioned
      default:
        // Unknown mode — deliver to be safe
        return true
    }
  }

  private pingGuardian(ack: ConnectAck): void {
    if (!this.socket?.connected) {
      this.config.onConnect?.(ack)
      return
    }

    let resolved = false
    const timer = setTimeout(() => {
      if (resolved) return
      resolved = true
      this.log.warn('[ExternalAgent] Guardian ping timed out — server may not support agent:ping')
      this.config.onConnect?.(ack)
    }, PING_TIMEOUT_MS)

    const onPong = () => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      this.config.onConnect?.(ack)
    }

    this.socket.once('agent:pong', onPong)
    this.socket.emit('agent:ping')
    this.log.info('[ExternalAgent] Sent agent:ping, waiting for guardian verification...')
  }

  private startContextCleanup(): void {
    this.stopContextCleanup()
    this.contextCleanupTimer = setInterval(() => {
      const now = Date.now()
      for (const [id, entry] of this.contextMap) {
        if (now - entry.receivedAt > CONTEXT_TTL_MS) {
          this.contextMap.delete(id)
        }
      }
    }, CONTEXT_TTL_MS)
  }

  private stopContextCleanup(): void {
    if (this.contextCleanupTimer) {
      clearInterval(this.contextCleanupTimer)
      this.contextCleanupTimer = null
    }
  }

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.connected) {
        this.socket.emit('heartbeat')
      }
    }, intervalMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }
}
