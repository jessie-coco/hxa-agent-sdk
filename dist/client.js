import { io } from 'socket.io-client';
const DEFAULT_SOCKET_PATH = '/ws';
const DEFAULT_ACK_TIMEOUT_MS = 10_000;
const MAX_RECONNECT_ATTEMPTS = 50;
/**
 * AgentClient — Socket.IO client for agents connecting to HxA Link.
 *
 * Handles authentication via invite_token (hxal_ prefix), heartbeat management,
 * message sending/receiving, and automatic reconnection.
 */
export class AgentClient {
    socket = null;
    heartbeatTimer = null;
    wsSessionToken = null;
    joinedConversations = new Set();
    config;
    log;
    constructor(config) {
        this.config = {
            autoReconnect: true,
            socketPath: DEFAULT_SOCKET_PATH,
            ...config,
        };
        this.log = config.logger ?? console;
        if (config.sessionToken) {
            this.wsSessionToken = config.sessionToken;
        }
    }
    /** Whether the socket is currently connected. */
    get isConnected() {
        return this.socket?.connected ?? false;
    }
    /** The agent ID from the invite package. */
    get agentId() {
        return this.config.invitePackage.agentId;
    }
    /** Current session token (for external persistence). */
    get sessionToken() {
        return this.wsSessionToken;
    }
    /** HTTP base URL derived from wsEndpoint (e.g. `https://host/hxa-link-api`). */
    get apiBaseUrl() {
        const ep = this.config.invitePackage.wsEndpoint;
        const parsed = new URL(ep);
        const origin = parsed.origin.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
        const apiBase = parsed.pathname.replace(/\/ws(\/.*)?$/, '');
        return `${origin}${apiBase}`;
    }
    /**
     * Connect to the HxA Link WebSocket server.
     * Uses invite_token auth on first connect, wsSessionToken on reconnect.
     */
    connect() {
        if (this.socket?.connected) {
            this.log.warn('[ExternalAgent] Already connected');
            return;
        }
        const { invitePackage, socketPath, autoReconnect } = this.config;
        // Parse the wsEndpoint — strip any path suffix like /ws/agent since Socket.IO uses its own path
        const baseUrl = invitePackage.wsEndpoint
            .replace(/\/ws\/agent\/?$/, '')
            .replace(/\/ws\/?$/, '');
        const authPayload = this.wsSessionToken
            ? { wsSessionToken: this.wsSessionToken }
            : { credential: invitePackage.inviteToken };
        this.socket = io(baseUrl, {
            path: socketPath,
            auth: authPayload,
            transports: ['websocket'],
            reconnection: autoReconnect,
            reconnectionAttempts: autoReconnect ? MAX_RECONNECT_ATTEMPTS : 0,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 30000,
        });
        this.registerListeners();
        this.log.info(`[ExternalAgent] Connecting to ${baseUrl} (path: ${socketPath})...`);
    }
    /**
     * Disconnect from the server and clean up resources.
     */
    disconnect() {
        this.stopHeartbeat();
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.disconnect();
            this.socket = null;
        }
        this.wsSessionToken = null;
        this.log.info('[ExternalAgent] Disconnected');
    }
    /**
     * Send a message to a conversation.
     *
     * @returns Promise that resolves with the server's status acknowledgment.
     */
    sendMessage(params, timeoutMs = DEFAULT_ACK_TIMEOUT_MS) {
        return new Promise((resolve, reject) => {
            if (!this.socket?.connected) {
                reject(new Error('Not connected'));
                return;
            }
            const timer = setTimeout(() => {
                reject(new Error(`sendMessage timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            const payload = {
                conversationId: params.conversationId,
                type: params.type ?? 'text',
                content: params.content,
                clientMsgId: params.clientMsgId ?? crypto.randomUUID(),
                replyToId: params.replyToId,
            };
            this.socket.emit('message:send', payload, (response) => {
                clearTimeout(timer);
                resolve(response);
            });
        });
    }
    /**
     * Send a typing indicator to a conversation.
     */
    sendTyping(conversationId, isTyping = true) {
        if (!this.socket?.connected) {
            this.log.warn('[ExternalAgent] Cannot send typing — not connected');
            return;
        }
        this.socket.emit('message:typing', { conversationId, isTyping });
    }
    /**
     * Join a conversation room for real-time message delivery.
     */
    joinConversation(conversationId, timeoutMs = DEFAULT_ACK_TIMEOUT_MS) {
        return new Promise((resolve, reject) => {
            if (!this.socket?.connected) {
                reject(new Error('Not connected'));
                return;
            }
            const timer = setTimeout(() => {
                reject(new Error(`joinConversation timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            this.socket.emit('conversation:join', { conversationId }, (response) => {
                clearTimeout(timer);
                resolve(response);
            });
        });
    }
    /**
     * Leave a conversation room.
     */
    leaveConversation(conversationId) {
        if (!this.socket?.connected)
            return;
        this.socket.emit('conversation:leave', { conversationId });
    }
    /**
     * Register a custom event handler on the underlying Socket.IO socket.
     * Use for platform-specific events not covered by the standard callbacks.
     */
    on(event, handler) {
        if (!this.socket) {
            throw new Error('Cannot register event handler before connect()');
        }
        this.socket.on(event, handler);
    }
    /**
     * Emit a custom event on the underlying Socket.IO socket.
     */
    emit(event, ...args) {
        if (!this.socket?.connected) {
            this.log.warn(`[ExternalAgent] Cannot emit '${event}' — not connected`);
            return;
        }
        this.socket.emit(event, ...args);
    }
    // ── Private ─────────────────────────────────────────────────────────────────
    registerListeners() {
        const socket = this.socket;
        // ── Connection established ─────────────────────────────────────────────
        socket.on('connect_ack', (ack) => {
            this.log.info(`[ExternalAgent] Connected as agent ${ack.agentId}`);
            this.wsSessionToken = ack.agentSessionToken;
            this.startHeartbeat(ack.heartbeatInterval);
            this.config.onSessionToken?.(ack.agentSessionToken);
            this.config.onConnect?.(ack);
        });
        // ── Incoming messages (broadcast from rooms.ts) ───────────────────────
        socket.on('message:new', (data) => {
            const message = 'message' in data && data.message ? data.message : data;
            this.log.debug(`[ExternalAgent] message:new in ${message.conversationId} from ${message.senderId}`);
            this.config.onMessage?.(message);
        });
        // ── Message status updates ────────────────────────────────────────────
        socket.on('message:status', (status) => {
            this.config.onMessageStatus?.(status);
        });
        // ── Message error ─────────────────────────────────────────────────────
        socket.on('message:error', (error) => {
            this.log.error(`[ExternalAgent] message:error: ${error.error}`, error);
        });
        // ── Message summary (for unjoined conversations) ───────────────────────
        socket.on('message:summary', (data) => {
            if (data.senderId === this.agentId)
                return;
            if (!this.joinedConversations.has(data.conversationId)) {
                this.log.info(`[ExternalAgent] Summary for unjoined conv ${data.conversationId}, auto-joining`);
                socket.emit('conversation:join', { conversationId: data.conversationId }, (resp) => {
                    if (resp?.success) {
                        this.joinedConversations.add(data.conversationId);
                        this.log.info(`[ExternalAgent] Auto-joined conv ${data.conversationId}`);
                    }
                    else {
                        this.log.warn(`[ExternalAgent] Auto-join failed for ${data.conversationId}: ${resp?.error}`);
                    }
                });
            }
            this.config.onMessageSummary?.(data);
        });
        // ── Offline message sync (on reconnect) ───────────────────────────────
        socket.on('message:sync', (sync) => {
            this.log.info(`[ExternalAgent] Synced ${sync.count} offline messages (hasMore: ${sync.hasMore})`);
            const convIds = new Set(sync.messages.map(m => m.conversationId));
            for (const convId of convIds) {
                if (!this.joinedConversations.has(convId)) {
                    socket.emit('conversation:join', { conversationId: convId }, (resp) => {
                        if (resp?.success) {
                            this.joinedConversations.add(convId);
                            this.log.info(`[ExternalAgent] Auto-joined conv ${convId} (from sync)`);
                        }
                    });
                }
            }
            this.config.onMessageSync?.(sync);
        });
        // ── Typing indicators ─────────────────────────────────────────────────
        socket.on('typing', (event) => {
            this.config.onTyping?.(event);
        });
        // ── Session token renewal ─────────────────────────────────────────────
        socket.on('session:renewed', (data) => {
            this.wsSessionToken = data.agentSessionToken;
            this.log.debug('[ExternalAgent] WS session token renewed');
            this.config.onSessionToken?.(data.agentSessionToken);
        });
        // ── Heartbeat ACK ─────────────────────────────────────────────────────
        socket.on('heartbeat_ack', (data) => {
            if (data?.serverTime) {
                const drift = Math.abs(Date.now() - data.serverTime);
                if (drift > 30_000) {
                    this.log.warn(`[ExternalAgent] Clock drift detected: ${drift}ms`);
                }
            }
        });
        // ── Server disconnect warning (10s before disconnect) ───────────────
        socket.on('disconnect:warning', (data) => {
            this.log.warn(`[ExternalAgent] Disconnect warning: ${data.reason} in ${data.disconnectInMs}ms`);
        });
        // ── Server-initiated disconnect reason ────────────────────────────────
        socket.on('disconnect:reason', (data) => {
            this.log.warn(`[ExternalAgent] Server disconnect: ${data.code} — ${data.message}`);
        });
        // ── Server error events ─────────────────────────────────────────────
        socket.on('error', (error) => {
            this.log.error(`[ExternalAgent] Server error: ${error.message}`);
        });
        // ── Socket.IO built-in events ─────────────────────────────────────────
        socket.on('connect', () => {
            this.log.info('[ExternalAgent] Socket.IO transport connected');
        });
        socket.on('disconnect', (reason) => {
            this.log.warn(`[ExternalAgent] Disconnected: ${reason}`);
            this.stopHeartbeat();
            this.joinedConversations.clear();
            // Socket.IO does NOT auto-reconnect on server-initiated disconnect
            if (reason === 'io server disconnect' && this.config.autoReconnect) {
                const delay = 5000;
                this.log.info(`[ExternalAgent] Server-initiated disconnect — retrying in ${delay / 1000}s`);
                setTimeout(() => {
                    if (!this.socket?.connected) {
                        this.log.info('[ExternalAgent] Manually reconnecting after server disconnect');
                        this.socket?.connect();
                    }
                }, delay);
            }
            this.config.onDisconnect?.(reason);
        });
        socket.on('connect_error', (error) => {
            this.log.error(`[ExternalAgent] Connection error: ${error.message}`);
            if (this.wsSessionToken && /auth|SESSION|INVALID/i.test(error.message)) {
                this.log.info('[ExternalAgent] Clearing stale session token, will retry with invite token');
                this.wsSessionToken = null;
                socket.auth = { credential: this.config.invitePackage.inviteToken };
            }
        });
        socket.io.on('reconnect', (attempt) => {
            this.log.info(`[ExternalAgent] Reconnected after ${attempt} attempt(s)`);
        });
        socket.io.on('reconnect_attempt', (attempt) => {
            this.log.debug(`[ExternalAgent] Reconnection attempt #${attempt}`);
            if (this.wsSessionToken) {
                socket.auth = { wsSessionToken: this.wsSessionToken };
            }
            else {
                socket.auth = { credential: this.config.invitePackage.inviteToken };
            }
        });
        socket.io.on('reconnect_failed', () => {
            this.log.error('[ExternalAgent] All reconnection attempts exhausted');
            this.config.onReconnectFailed?.();
        });
    }
    startHeartbeat(intervalMs) {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            if (this.socket?.connected) {
                this.socket.emit('heartbeat');
            }
        }, intervalMs);
    }
    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
}
//# sourceMappingURL=client.js.map