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
    private readonly config;
    private readonly log;
    constructor(config: AgentSDKConfig);
    /** Whether the socket is currently connected. */
    get isConnected(): boolean;
    /** The agent ID from the invite package. */
    get agentId(): string;
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
    private registerListeners;
    private startHeartbeat;
    private stopHeartbeat;
}
//# sourceMappingURL=client.d.ts.map