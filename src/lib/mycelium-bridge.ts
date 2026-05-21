/**
 * mycelium-bridge.ts — typed helpers for Mycelium Bridge agent RPCs.
 *
 * All functions use the existing callOpenClawGateway WebSocket transport.
 * The bridge must be reachable at the configured gateway URL.
 */
import { callOpenClawGateway, callOpenClawGatewayCollectEvents, GatewayStreamResult } from './openclaw-gateway'

export interface MyceliumAgentParams {
  id: string
  name: string
  provider: string
  model: string
  system_prompt?: string
  tools?: string[]
  channels?: string[]
  status?: string
}

export interface MyceliumAgent {
  id: string
  name: string
  provider: string
  model: string
  system_prompt?: string
  tools?: string[]
  channels?: string[]
  /** Runtime status: idle | busy | offline */
  status: string
  /** Profile admin status: online | offline */
  profile_status: string
  framework: string
  created_at: string
  updated_at: string
}

export async function bridgeAgentsCreate(params: MyceliumAgentParams): Promise<MyceliumAgent> {
  return callOpenClawGateway<MyceliumAgent>('agents_create', params)
}

export async function bridgeAgentsList(): Promise<MyceliumAgent[]> {
  const result = await callOpenClawGateway<{ agents: MyceliumAgent[] }>('agents_list', {})
  const all = result?.agents ?? []
  return all.filter((a) => a.framework === 'mycelium')
}

export async function bridgeAgentsDelete(id: string): Promise<void> {
  await callOpenClawGateway('agents_delete', { id })
}

/** Re-export for consumers that want the full type. */
export type SessionSendResult = GatewayStreamResult

/**
 * Send a message to a Mycelium Bridge agent and await the full response.
 * Keeps the WebSocket open to collect streaming session.message events,
 * resolving once task.updated carries status completed or failed.
 * Timeout: 30 s (LLM calls can be slow on free models).
 */
export async function bridgeSessionsSend(params: {
  agent_id: string
  session_id?: string
  message: string
}): Promise<SessionSendResult> {
  return callOpenClawGatewayCollectEvents('sessions_send', params, 60000)
}
