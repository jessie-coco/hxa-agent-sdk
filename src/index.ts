export { AgentClient, AgentClient as ExternalAgentClient } from './client.js'
export { parseMessageContent, resolveMediaUrl, formatFileSize } from './content.js'
export { downloadMedia } from './media.js'
export type {
  InvitePackage,
  AgentSDKConfig,
  ExternalChannelConfig,
  IncomingMessage,
  SendMessageParams,
  MessageStatus,
  MessageSync,
  MessageSummary,
  ConnectAck,
  TypingEvent,
  Logger,
  MessageType,
  ParsedContent,
  TextContent,
  ImageContent,
  FileContent,
  VoiceContent,
  VideoContent,
  CardContent,
  LocationContent,
  EmojiBigContent,
  PollContent,
  BurnAfterReadingContent,
  DownloadMediaOptions,
  ResponseMode,
  AgentContext,
  MessageFilterConfig,
} from './types.js'

import { AgentClient } from './client.js'
import type { AgentSDKConfig } from './types.js'

/**
 * Create an agent client for connecting to HxA Link.
 *
 * @example
 * ```ts
 * import { createAgent, parseMessageContent, downloadMedia } from '@hxa/agent-sdk'
 *
 * const client = createAgent({
 *   invitePackage: { agentId: '...', inviteToken: 'hxal_...', wsEndpoint: 'wss://...' },
 *   onMessage: async (msg) => {
 *     const content = parseMessageContent(msg)
 *     if (content.type === 'image') {
 *       const buf = await downloadMedia({ url: content.url, authToken: '...' })
 *       console.log(`Image downloaded: ${buf.length} bytes`)
 *     }
 *   },
 * })
 * client.connect()
 * ```
 */
export function createAgent(config: AgentSDKConfig): AgentClient {
  return new AgentClient(config)
}

/** @deprecated Use createAgent instead */
export const createExternalAgent = createAgent
