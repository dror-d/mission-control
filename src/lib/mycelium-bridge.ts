/**
 * mycelium-bridge.ts — typed helpers for Mycelium Bridge agent RPCs.
 *
 * All functions use the existing callOpenClawGateway WebSocket transport.
 * The bridge must be reachable at the configured gateway URL.
 */
import { callOpenClawGateway } from './openclaw-gateway'

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
