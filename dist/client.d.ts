import type { AgentSDKConfig, MessageStatus, SendMessageParams } from './types.js';
/**
 * AgentClient — Socket.IO client for agents connecting to HxA Link.
 *
 * Handles authentication via invite_token (hxal_ prefix), heartbeat management,
 * message sending/receiving, and automatic reconnection.
 */
export declare class AgentClient {
    private socket;
    private heartbeatTimer;
    private wsSessionToken;
    private joinedConversations;
    private readonly config;
    private readonly log;
    constructor(config: AgentSDKConfig);
    /** Derive Socket.IO path from the wsEndpoint URL (strip trailing segments after /ws). */
    private static deriveSocketPath;
    /** Whether the socket is currently connected. */
    get isConnected(): boolean;
    /** The agent ID from the invite package. */
    get agentId(): string;
    /** Current session token (for external persistence). */
    get sessionToken(): string | null;
    /** HTTP base URL derived from wsEndpoint (e.g. `https://host/hxa-link-api`). */
    get apiBaseUrl(): string;
    /**
     * Connect to the HxA Link WebSocket server.
     * Uses invite_token auth on first connect, wsSessionToken on reconnect.
     */
    connect(): void;
    /**
     * Disconnect from the server and clean up resources.
     */
    disconnect(): void;
    /**
     * Send a message to a conversation.
     *
     * @returns Promise that resolves with the server's status acknowledgment.
     */
    sendMessage(params: SendMessageParams, timeoutMs?: number): Promise<MessageStatus>;
    /**
     * Send a typing indicator to a conversation.
     */
    sendTyping(conversationId: string, isTyping?: boolean): void;
    /**
     * Join a conversation room for real-time message delivery.
     */
    joinConversation(conversationId: string, timeoutMs?: number): Promise<{
        success: boolean;
        error?: string;
    }>;
    /**
     * Leave a conversation room.
     */
    leaveConversation(conversationId: string): void;
    /**
     * Register a custom event handler on the underlying Socket.IO socket.
     * Use for platform-specific events not covered by the standard callbacks.
     */
    on(event: string, handler: (...args: unknown[]) => void): void;
    /**
     * Emit a custom event on the underlying Socket.IO socket.
     */
    emit(event: string, ...args: unknown[]): void;
    private registerListeners;
    private startHeartbeat;
    private stopHeartbeat;
}
//# sourceMappingURL=client.d.ts.map