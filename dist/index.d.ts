export { AgentClient, AgentClient as ExternalAgentClient } from './client.js';
export { parseMessageContent, resolveMediaUrl, formatFileSize } from './content.js';
export { downloadMedia } from './media.js';
export type { InvitePackage, AgentSDKConfig, ExternalChannelConfig, IncomingMessage, SendMessageParams, MessageStatus, MessageSync, MessageSummary, ConnectAck, TypingEvent, Logger, MessageType, ParsedContent, TextContent, ImageContent, FileContent, VoiceContent, VideoContent, CardContent, LocationContent, EmojiBigContent, PollContent, BurnAfterReadingContent, DownloadMediaOptions, } from './types.js';
import { AgentClient } from './client.js';
import type { AgentSDKConfig } from './types.js';
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
export declare function createAgent(config: AgentSDKConfig): AgentClient;
/** @deprecated Use createAgent instead */
export declare const createExternalAgent: typeof createAgent;
//# sourceMappingURL=index.d.ts.map