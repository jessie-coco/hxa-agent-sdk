export { AgentClient, AgentClient as ExternalAgentClient } from './client.js';
import { AgentClient } from './client.js';
/**
 * Create an agent client for connecting to HxA Link.
 *
 * @example
 * ```ts
 * import { createAgent } from '@hxa/agent-sdk'
 *
 * const client = createAgent({
 *   invitePackage: { agentId: '...', inviteToken: 'hxal_...', wsEndpoint: 'wss://...' },
 *   onMessage: (msg) => console.log('Received:', msg),
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