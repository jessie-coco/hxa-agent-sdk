import { io, type Socket } from 'socket.io-client'
import type {
  AgentSDKConfig,
  IncomingMessage,
  ConnectAck,
  MessageStatus,
  MessageSync,
  MessageSummary,
  TypingEvent,
  Logger,
  SendMessageParams,
} from './types.js'

const DEFAULT_SOCKET_PATH = '/ws'
const DEFAULT_ACK_TIMEOUT_MS = 10_000
const MAX_RECONNECT_ATTEMPTS = 50

/**
 * AgentClient — Socket.IO client for agents connecting to HxA Link.
 *
 * Handles authentication via invite_token (hxal_ prefix), heartbeat management,
 * message sending/receiving, and automatic reconnection.
 */
export class AgentClient {
  private socket: Socket | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private wsSessionToken: string | null = null
  private joinedConversations = new Set<string>()
  private readonly config: Required<Pick<AgentSDKConfig, 'autoReconnect' | 'socketPath'>> & AgentSDKConfig
  private readonly log: Logger

  constructor(config: AgentSDKConfig) {
    this.config = {
      autoReconnect: true,
      socketPath: DEFAULT_SOCKET_PATH,
      ...config,
    }
    this.log = config.logger ?? console
  }

  /** Whether the socket is currently connected. */
  get isConnected(): boolean {
    return this.socket?.connected ?? false
  }

  /** The agent ID from the invite package. */
  get agentId(): string {
    return this.config.invitePackage.agentId
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

    // Parse the wsEndpoint — strip any path suffix like /ws/agent since Socket.IO uses its own path
    const baseUrl = invitePackage.wsEndpoint
      .replace(/\/ws\/agent\/?$/, '')
      .replace(/\/ws\/?$/, '')

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
    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.disconnect()
      this.socket = null
    }
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

  // ── Private ─────────────────────────────────────────────────────────────────

  private registerListeners(): void {
    const socket = this.socket!

    // ── Connection established ─────────────────────────────────────────────
    socket.on('connect_ack', (ack: ConnectAck) => {
      this.log.info(`[ExternalAgent] Connected as agent ${ack.agentId}`)
      this.wsSessionToken = ack.agentSessionToken
      this.startHeartbeat(ack.heartbeatInterval)
      this.config.onConnect?.(ack)
    })

    // ── Incoming messages (broadcast from rooms.ts) ───────────────────────
    socket.on('message:new', (data: IncomingMessage | { message: IncomingMessage }) => {
      const message = 'message' in data && data.message ? data.message : data as IncomingMessage
      this.log.debug(`[ExternalAgent] message:new in ${message.conversationId} from ${message.senderId}`)
      this.config.onMessage?.(message)
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
      // Use wsSessionToken for fast reconnect, fall back to invite_token if unavailable
      if (this.wsSessionToken) {
        socket.auth = { wsSessionToken: this.wsSessionToken }
      } else {
        socket.auth = { credential: this.config.invitePackage.inviteToken }
      }
    })
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
