#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createAgent } from './index.js'

interface SendConfig {
  agentId: string
  inviteToken: string
  wsEndpoint: string
  socketPath?: string
  autoReconnect?: boolean
}

function getArg(name: string): string | undefined {
  const args = process.argv.slice(2)
  const idx = args.indexOf(`--${name}`)
  return idx === -1 ? undefined : args[idx + 1]
}

function requireArg(name: string): string {
  const value = getArg(name)
  if (!value) throw new Error(`--${name} is required`)
  return value
}

function resolveConfigPath(): string {
  const argPath = getArg('config')
  if (argPath) return path.resolve(argPath)
  const envPath = process.env.HXA_LINK_CONFIG || process.env.HXA_LINK_COMPONENT_CONFIG
  if (envPath) return path.resolve(envPath)
  return path.resolve(process.env.HOME || '~', 'zylos', 'components', 'hxa-link', 'config.json')
}

function loadConfig(): SendConfig {
  const configPath = resolveConfigPath()
  const raw = fs.readFileSync(configPath, 'utf8')
  const parsed = JSON.parse(raw) as SendConfig
  if (!parsed.agentId || !parsed.inviteToken || !parsed.wsEndpoint) {
    throw new Error('config requires agentId, inviteToken, and wsEndpoint')
  }
  return parsed
}

function parseConversationId(endpoint: string): string {
  return endpoint.startsWith('conv:') ? endpoint.slice('conv:'.length) : endpoint
}

async function main() {
  const config = loadConfig()
  const endpoint = requireArg('endpoint')
  const message = requireArg('message')
  const conversationId = parseConversationId(endpoint)

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const client = createAgent({
      invitePackage: {
        agentId: config.agentId,
        inviteToken: config.inviteToken,
        wsEndpoint: config.wsEndpoint,
      },
      socketPath: config.socketPath,
      autoReconnect: false,
      logger: console,
      onConnect: async () => {
        if (settled) return
        try {
          await client.sendMessage({
            conversationId,
            content: message,
          })
          settled = true
          clearTimeout(timeout)
          client.disconnect()
          resolve()
        } catch (err) {
          settled = true
          clearTimeout(timeout)
          client.disconnect()
          reject(err)
        }
      },
      onDisconnect: (reason) => {
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          reject(new Error(`disconnected before send: ${reason}`))
        }
      },
    })

    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      client.disconnect()
      reject(new Error('connect timeout'))
    }, 15000)

    client.connect()
  })
}

main().catch((err) => {
  console.error('[hxa-link send-once] fatal:', err)
  process.exit(1)
})
