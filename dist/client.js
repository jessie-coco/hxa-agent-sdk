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
    config;
    log;
    constructor(config) {
        this.config = {
            autoReconnect: true,
            socketPath: DEFAULT_SOCKET_PATH,
            ...config,
        };
        this.log = config.logger ?? console;
    }
    /** Whether the socket is currently connected. */
    get isConnected() {
        return this.socket?.connected ?? false;
    }
    /** The agent ID from the invite package. */
    get agentId() {
        return this.config.invitePackage.agentId;
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
    // ── Private ─────────────────────────────────────────────────────────────────
    registerListeners() {
        const socket = this.socket;
        // ── Connection established ─────────────────────────────────────────────
        socket.on('connect_ack', (ack) => {
            this.log.info(`[ExternalAgent] Connected as agent ${ack.agentId}`);
            this.wsSessionToken = ack.agentSessionToken;
            this.startHeartbeat(ack.heartbeatInterval);
            this.config.onConnect?.(ack);
        });
        // ── Incoming messages (broadcast from rooms.ts) ───────────────────────
        socket.on('message:new', (message) => {
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
        // ── Offline message sync (on reconnect) ───────────────────────────────
        socket.on('message:sync', (sync) => {
            this.log.info(`[ExternalAgent] Synced ${sync.count} offline messages (hasMore: ${sync.hasMore})`);
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
            this.config.onDisconnect?.(reason);
        });
        socket.on('connect_error', (error) => {
            this.log.error(`[ExternalAgent] Connection error: ${error.message}`);
        });
        socket.io.on('reconnect', (attempt) => {
            this.log.info(`[ExternalAgent] Reconnected after ${attempt} attempt(s)`);
        });
        socket.io.on('reconnect_attempt', (attempt) => {
            this.log.debug(`[ExternalAgent] Reconnection attempt #${attempt}`);
            // Use wsSessionToken for fast reconnect, fall back to invite_token if unavailable
            if (this.wsSessionToken) {
                socket.auth = { wsSessionToken: this.wsSessionToken };
            }
            else {
                socket.auth = { credential: this.config.invitePackage.inviteToken };
            }
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