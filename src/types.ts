/**
 * Invite package issued by HxA Link when an external agent is registered.
 * Contains everything needed to establish a WebSocket connection.
 */
export interface InvitePackage {
  agentId: string
  inviteToken: string
  wsEndpoint: string
}

/** All supported message content types — must match the platform DB schema. */
export type MessageType =
  | 'text' | 'image' | 'file' | 'voice' | 'video'
  | 'card' | 'location' | 'emoji_big' | 'poll' | 'burn_after_reading'

// ── Typed content interfaces (discriminated on `type`) ──────────────────────

export interface TextContent {
  type: 'text'
  text: string
}

export interface ImageContent {
  type: 'image'
  url: string
  fileName?: string
  caption?: string
  size?: number
  width?: number
  height?: number
}

export interface FileContent {
  type: 'file'
  url: string
  fileName: string
  size?: number
  mimeType?: string
}

export interface VoiceContent {
  type: 'voice'
  url: string
  duration?: number
}

export interface VideoContent {
  type: 'video'
  url: string
  fileName?: string
  duration?: number
  size?: number
  width?: number
  height?: number
}

export interface CardContent {
  type: 'card'
  title: string
  subtitle?: string
  fields?: Array<{ label: string; value: string }>
  actions?: Array<{ label: string; url: string }>
}

export interface LocationContent {
  type: 'location'
  latitude: number
  longitude: number
  name?: string
  address?: string
}

export interface EmojiBigContent {
  type: 'emoji_big'
  emoji: string
}

export interface PollContent {
  type: 'poll'
  question: string
  options: Array<{ text: string; votes?: number }>
}

export interface BurnAfterReadingContent {
  type: 'burn_after_reading'
  text: string
}

export type ParsedContent =
  | TextContent
  | ImageContent
  | FileContent
  | VoiceContent
  | VideoContent
  | CardContent
  | LocationContent
  | EmojiBigContent
  | PollContent
  | BurnAfterReadingContent

// ── Media download ──────────────────────────────────────────────────────────

export interface DownloadMediaOptions {
  url: string
  baseUrl?: string
  authToken?: string
  timeout?: number
}

/**
 * Incoming message received via the WebSocket `message:new` broadcast.
 * Fields match the server-side message schema from rooms.ts broadcastMessage.
 */
export interface IncomingMessage {
  id: string
  conversationId: string
  senderId: string
  senderType: 'user' | 'agent'
  type: MessageType
  content: string | Record<string, unknown>
  seq: number
  clientMsgId?: string
  replyToId?: string
  forwardedFrom?: string
  createdAt: string
}

/**
 * Message status update received via `message:status`.
 */
export interface MessageStatus {
  clientMsgId?: string
  messageId?: string
  seq?: number
  status: 'sent' | 'delivered' | 'read'
  timestamp?: string | number
  conversationId?: string
  readBy?: string
  lastReadSeq?: number
}

/**
 * Offline message sync payload received on connect via `message:sync`.
 */
export interface MessageSync {
  messages: IncomingMessage[]
  count: number
  hasMore: boolean
}

/**
 * Connection acknowledgment from the server.
 */
export interface ConnectAck {
  agentId: string
  entityType: 'agent'
  agentSessionToken: string
  heartbeatInterval: number
  serverTime: number
}

/**
 * Message summary received via `message:summary` when not in the conversation room.
 * Delivered through the user:{id} room as a notification.
 */
export interface MessageSummary {
  conversationId: string
  senderId: string
  senderName?: string
  preview?: string
}

/**
 * Typing indicator received via `typing` event.
 */
export interface TypingEvent {
  conversationId: string
  userId: string
  isTyping: boolean
}

/**
 * Parameters for sending a message via `message:send`.
 */
export interface SendMessageParams {
  conversationId: string
  type?: MessageType
  content: string | Record<string, unknown>
  clientMsgId?: string
  replyToId?: string
}

/**
 * Logger interface — compatible with console, pino, winston, etc.
 */
export interface Logger {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
  debug(message: string, ...args: unknown[]): void
}

/**
 * Configuration for creating an AgentClient.
 */
export interface AgentSDKConfig {
  /** Invite package with agent credentials and endpoint */
  invitePackage: InvitePackage

  /** Pre-existing session token for fast reconnect (e.g. loaded from disk) */
  sessionToken?: string

  /** Called when a new message is received */
  onMessage?: (message: IncomingMessage) => void | Promise<void>

  /** Called when connection is established (after connect_ack) */
  onConnect?: (ack: ConnectAck) => void | Promise<void>

  /** Called when disconnected */
  onDisconnect?: (reason: string) => void | Promise<void>

  /** Called when the session token is updated (connect_ack or session:renewed) — persist it */
  onSessionToken?: (token: string) => void

  /** Called when all reconnection attempts are exhausted */
  onReconnectFailed?: () => void

  /** Called on message status updates */
  onMessageStatus?: (status: MessageStatus) => void | Promise<void>

  /** Called on typing indicators */
  onTyping?: (event: TypingEvent) => void | Promise<void>

  /** Called when offline messages are synced on reconnect */
  onMessageSync?: (sync: MessageSync) => void | Promise<void>

  /** Called when a message summary is received for an unjoined conversation */
  onMessageSummary?: (summary: MessageSummary) => void | Promise<void>

  /** Enable automatic reconnection (default: true) */
  autoReconnect?: boolean

  /** Logger instance (default: console) */
  logger?: Logger

  /**
   * Socket.IO path override.
   * Auto-derived from wsEndpoint by default (strips segments after `/ws`).
   * Only set this if your reverse proxy uses a non-standard path.
   * Example: wsEndpoint 'wss://host/hxa-link-api/ws/agent' → auto-derives '/hxa-link-api/ws'
   */
  socketPath?: string

  /**
   * Message filter options for response-mode based filtering of group messages.
   * When enabled (default), the SDK listens for `message:agent-context` events and
   * only delivers group messages that pass the response mode check to `onMessage`.
   *
   * DMs and own messages are always delivered regardless of this setting.
   */
  messageFilter?: MessageFilterConfig
}

/**
 * Response mode sent by HxA Link in `message:agent-context` events.
 * Controls whether a group message should be delivered to the agent's onMessage callback.
 *
 * - `all` / `proactive`: always deliver
 * - `at_only`: deliver only if the agent is mentioned (default when server sends null)
 * - `silent`: never deliver
 */
export type ResponseMode = 'all' | 'proactive' | 'at_only' | 'silent'

/**
 * Agent context received via the `message:agent-context` event.
 * Sent by HxA Link for each group message to provide agent-specific metadata.
 */
export interface AgentContext {
  messageId: string
  conversationId: string
  responseMode: ResponseMode | null
  isMentioned: boolean
}

/**
 * Message filter configuration for controlling which group messages
 * are delivered to the onMessage callback based on agent context.
 */
export interface MessageFilterConfig {
  /** Enable response-mode filtering (default: true) */
  enabled?: boolean
}

/** @deprecated Use AgentSDKConfig instead */
export type ExternalChannelConfig = AgentSDKConfig
