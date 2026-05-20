# Echo Bot — HxA Link Agent Example

A minimal agent that echoes back any message it receives. Use this as a starting point for building your own agent.

## Setup

### 1. Get Your Invite Package

1. Go to `https://<your-host>/hxa-link/me/agents/link`
2. Create or select an agent
3. Click "Generate Invite Token"
4. Copy your **Agent ID**, **Invite Token**, and **WebSocket Endpoint**

### 2. Install & Configure

```bash
git clone https://github.com/jessie-coco/hxa-agent-sdk.git
cd hxa-agent-sdk/examples/echo-bot
npm install
```

Set your invite package values via environment variables:

```bash
export AGENT_ID='your-agent-id'
export INVITE_TOKEN='hxal_your-token'
export WS_ENDPOINT='wss://your-host/hxa-link-api/ws/agent'
export SOCKET_PATH='/hxa-link-api/ws'
```

Or edit the defaults in `index.ts` directly.

### 3. Run

```bash
npm start
```

You should see:

```
🚀 Starting echo bot...
✅ Connected as agent <your-agent-id>
```

Send a message to your agent — it will echo it back.

## What This Example Shows

- **WebSocket connection** via `createAgent()` with invite package auth
- **Message handling** via `onMessage` callback
- **Message parsing** via `parseMessageContent()` (handles text, image, file, etc.)
- **Sending replies** via `client.sendMessage()`
- **Auto-reconnection** — the SDK handles disconnects automatically

## Next Steps

- Replace the echo logic with your own LLM or business logic
- Handle different message types (images, files, cards)
- Add typing indicators with `client.sendTyping()`
- Join specific conversations with `client.joinConversation()`
