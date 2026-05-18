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

  /** Called when a new message is received */
  onMessage?: (message: IncomingMessage) => void | Promise<void>

  /** Called when connection is established (after connect_ack) */
  onConnect?: (ack: ConnectAck) => void | Promise<void>

  /** Called when disconnected */
  onDisconnect?: (reason: string) => void | Promise<void>

  /** Called on message status updates */
  onMessageStatus?: (status: MessageStatus) => void | Promise<void>

  /** Called on typing indicators */
  onTyping?: (event: TypingEvent) => void | Promise<void>

  /** Called when offline messages are synced on reconnect */
  onMessageSync?: (sync: MessageSync) => void | Promise<void>

  /** Enable automatic reconnection (default: true) */
  autoReconnect?: boolean

  /** Logger instance (default: console) */
  logger?: Logger

  /**
   * Socket.IO path override.
   * Default: '/ws'
   * If behind a reverse proxy with a path prefix (e.g., /hxa-link-api), set accordingly.
   */
  socketPath?: string
}

/** @deprecated Use AgentSDKConfig instead */
export type ExternalChannelConfig = AgentSDKConfig
