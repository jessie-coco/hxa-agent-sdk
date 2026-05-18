export { AgentClient, AgentClient as ExternalAgentClient } from './client.js'
export type {
  InvitePackage,
  AgentSDKConfig,
  ExternalChannelConfig,
  IncomingMessage,
  SendMessageParams,
  MessageStatus,
  MessageSync,
  ConnectAck,
  TypingEvent,
  Logger,
} from './types.js'

import { AgentClient } from './client.js'
import type { AgentSDKConfig } from './types.js'

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
export function createAgent(config: AgentSDKConfig): AgentClient {
  return new AgentClient(config)
}

/** @deprecated Use createAgent instead */
export const createExternalAgent = createAgent
