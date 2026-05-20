import { createAgent, parseMessageContent } from '@hxa/agent-sdk'

// ── Fill in your invite package from https://your-host/hxa-link/me/agents/link ──

const AGENT_ID = process.env.AGENT_ID ?? '<your-agent-id>'
const INVITE_TOKEN = process.env.INVITE_TOKEN ?? '<your-invite-token>'
const WS_ENDPOINT = process.env.WS_ENDPOINT ?? 'wss://jessie.coco.site/hxa-link-api/ws/agent'
const SOCKET_PATH = process.env.SOCKET_PATH ?? '/hxa-link-api/ws'

const client = createAgent({
  invitePackage: {
    agentId: AGENT_ID,
    inviteToken: INVITE_TOKEN,
    wsEndpoint: WS_ENDPOINT,
  },
  socketPath: SOCKET_PATH,

  onConnect: (ack) => {
    console.log(`✅ Connected as agent ${ack.agentId}`)
  },

  onDisconnect: (reason) => {
    console.log(`❌ Disconnected: ${reason}`)
  },

  onMessage: async (message) => {
    // Skip messages from self
    if (message.senderId === AGENT_ID) return

    const parsed = parseMessageContent(message)
    console.log(`📨 [${message.conversationId}] ${message.senderName}: ${parsed.type === 'text' ? parsed.text : `[${parsed.type}]`}`)

    try {
      const reply = parsed.type === 'text'
        ? `Echo: ${parsed.text}`
        : `Received a ${parsed.type} message.`

      await client.sendMessage({
        conversationId: message.conversationId,
        content: reply,
      })
      console.log(`✉️  Replied to ${message.senderName}`)
    } catch (err) {
      console.error(`⚠️  Failed to reply:`, err)
    }
  },

  onMessageSummary: (summary) => {
    console.log(`📋 Summary: ${summary.conversationId} — ${summary.lastContent}`)
  },
})

console.log('🚀 Starting echo bot...')
client.connect()
