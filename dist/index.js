export { AgentClient, AgentClient as ExternalAgentClient } from './client.js';
export { parseMessageContent, resolveMediaUrl, formatFileSize } from './content.js';
export { downloadMedia } from './media.js';
import { AgentClient } from './client.js';
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
export function createAgent(config) {
    return new AgentClient(config);
}
/** @deprecated Use createAgent instead */
export const createExternalAgent = createAgent;
//# sourceMappingURL=index.js.map