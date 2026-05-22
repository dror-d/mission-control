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
 * Timeout: 60 s (LLM calls can be slow on free models).
 */
export async function bridgeSessionsSend(params: {
  agent_id: string
  session_id?: string
  message: string
}): Promise<SessionSendResult> {
  return callOpenClawGatewayCollectEvents('sessions_send', params, 60000)
}

// ── Soul document ──────────────────────────────────────────────────────────────

export interface BridgeSoulResult {
  id: string
  soul_document: string
}

export async function bridgeAgentsGetSoul(agentId: string): Promise<BridgeSoulResult> {
  return callOpenClawGateway<BridgeSoulResult>('agents_get_soul', { id: agentId })
}

export async function bridgeAgentsSetSoul(agentId: string, soulDocument: string): Promise<void> {
  await callOpenClawGateway('agents_set_soul', { id: agentId, soul_document: soulDocument })
}

// ── Working memory ─────────────────────────────────────────────────────────────

export interface BridgeMemoryResult {
  id: string
  working_memory: string
  size: number
}

export async function bridgeAgentsGetMemory(agentId: string): Promise<BridgeMemoryResult> {
  return callOpenClawGateway<BridgeMemoryResult>('agents_get_memory', { id: agentId })
}

export async function bridgeAgentsSetMemory(agentId: string, memory: string): Promise<void> {
  await callOpenClawGateway('agents_set_memory', { id: agentId, working_memory: memory })
}

export async function bridgeAgentsAppendMemory(agentId: string, text: string): Promise<void> {
  await callOpenClawGateway('agents_append_memory', { id: agentId, working_memory: text })
}

// ── Provider management ────────────────────────────────────────────────────────

export interface BridgeProvider {
  id: string
  name: string
  type: string        // "openrouter" | "claude"
  model: string
  api_key: string     // redacted: first 8 chars + "..."
  priority: number
  enabled: boolean
  created_at: number  // unix timestamp
  updated_at: number
}

export interface BridgeProviderCreateParams {
  name: string
  type: string
  api_key: string
  model: string
  priority?: number
}

export interface BridgeProviderUpdateParams {
  id: string
  name?: string
  api_key?: string
  model?: string
  priority?: number
  enabled?: boolean
}

export async function bridgeProvidersList(): Promise<BridgeProvider[]> {
  const result = await callOpenClawGateway<{ providers: BridgeProvider[] }>('providers_list', {})
  return result?.providers ?? []
}

export async function bridgeProvidersCreate(params: BridgeProviderCreateParams): Promise<BridgeProvider> {
  return callOpenClawGateway<BridgeProvider>('providers_create', params)
}

export async function bridgeProvidersUpdate(params: BridgeProviderUpdateParams): Promise<BridgeProvider> {
  return callOpenClawGateway<BridgeProvider>('providers_update', params)
}

export async function bridgeProvidersDelete(id: string): Promise<void> {
  await callOpenClawGateway('providers_delete', { id })
}

export async function bridgeProvidersTest(id: string): Promise<{ id: string; available: boolean; enabled: boolean }> {
  return callOpenClawGateway('providers_test', { id })
}

// ── Knowledge base ─────────────────────────────────────────────────────────────

export interface BridgeKnowledgeDoc {
  id: string
  title: string
  slug: string
  scope: string        // "shared" | "agent:{id}"
  content: string      // Markdown
  created_at: number   // unix timestamp
  updated_at: number
}

export interface BridgeKnowledgeSearchResult {
  id: string
  title: string
  slug: string
  scope: string
  snippet: string      // excerpt with matched terms wrapped in ** ... **
  rank: number         // BM25 score (negative — lower is better)
}

export async function bridgeKnowledgeList(scope?: string, limit = 20, offset = 0): Promise<BridgeKnowledgeDoc[]> {
  const result = await callOpenClawGateway<{ docs: BridgeKnowledgeDoc[] }>(
    'knowledge_list', { scope: scope ?? '', limit, offset }
  )
  return result?.docs ?? []
}

export async function bridgeKnowledgeGet(id: string): Promise<BridgeKnowledgeDoc> {
  return callOpenClawGateway<BridgeKnowledgeDoc>('knowledge_get', { id })
}

export async function bridgeKnowledgeGetBySlug(slug: string, scope = 'shared'): Promise<BridgeKnowledgeDoc> {
  return callOpenClawGateway<BridgeKnowledgeDoc>('knowledge_get', { slug, scope })
}

export async function bridgeKnowledgeSave(params: {
  id?: string
  title: string
  slug?: string
  scope?: string
  content: string
}): Promise<BridgeKnowledgeDoc> {
  return callOpenClawGateway<BridgeKnowledgeDoc>('knowledge_save', params)
}

export async function bridgeKnowledgeDelete(id: string): Promise<void> {
  await callOpenClawGateway('knowledge_delete', { id })
}

export async function bridgeKnowledgeSearch(
  query: string,
  scopes: string[] = ['shared'],
  limit = 10
): Promise<BridgeKnowledgeSearchResult[]> {
  const result = await callOpenClawGateway<{ results: BridgeKnowledgeSearchResult[] }>(
    'knowledge_search', { query, scopes, limit }
  )
  return result?.results ?? []
}

export async function bridgeKnowledgeGraph(scope?: string): Promise<{
  nodes: Array<{ id: string; title: string; slug: string; scope: string }>
  edges: Array<{ from: string; to: string }>
}> {
  return callOpenClawGateway('knowledge_graph', { scope: scope ?? '' })
}

// ── Observability: context preview & session inspection (Phase 2G) ─────────────

export interface BridgePreviewSection {
  name: string
  tokens: number
  skipped?: boolean
  reason?: string
}

export interface BridgeKnowledgeDocInfo {
  id: string
  title: string
  scope: string
}

export interface BridgePreviewMessage {
  role: string
  content: string
}

export interface BridgeContextPreviewResult {
  agent_id: string
  provider: string
  model: string
  sections: BridgePreviewSection[]
  full_text: string
  total_tokens: number
  knowledge_docs: BridgeKnowledgeDocInfo[]
  messages: BridgePreviewMessage[]
  warnings: string[]
}

export async function bridgeContextPreview(params: {
  agent_id: string
  session_id?: string
  message?: string
}): Promise<BridgeContextPreviewResult> {
  return callOpenClawGateway<BridgeContextPreviewResult>('context_preview', params)
}

export interface BridgeSessionMessage {
  id: string
  role: string
  content: string
  created_at: number
}

export interface BridgeSessionTask {
  id: string
  status: string
  error: string
  created_at: number
  updated_at: number
}

export interface BridgeSessionDetail {
  session_id: string
  agent_id: string
  status: string
  created_at: number
  updated_at: number
  session_notes: string
  messages: BridgeSessionMessage[]
  tasks: BridgeSessionTask[]
  total_input_tokens: number
  total_output_tokens: number
}

export async function bridgeSessionsGet(sessionId: string): Promise<BridgeSessionDetail> {
  return callOpenClawGateway<BridgeSessionDetail>('sessions_get', { session_id: sessionId })
}

// ── Agent-to-Agent Messaging (Phase 2H) ───────────────────────────────────────

export interface BridgeAgentMessageResult {
  response_text: string
  session_id: string
  task_id: string
  input_tokens: number
  output_tokens: number
}

export async function bridgeAgentMessage(params: {
  from_agent_id: string
  to_agent_id: string
  message: string
  session_id?: string
}): Promise<BridgeAgentMessageResult> {
  return callOpenClawGateway<BridgeAgentMessageResult>('agent_message', params)
}

// ── Sessions list (bridge sessions) ───────────────────────────────────────────

export interface BridgeSessionSummary {
  id: string
  agent_id: string
  status: string        // "active" | "completed" | "failed"
  created_at: number    // unix seconds
  updated_at: number    // unix seconds
}

export async function bridgeSessionsList(): Promise<BridgeSessionSummary[]> {
  const result = await callOpenClawGateway<{ sessions: BridgeSessionSummary[] }>('sessions_list', {})
  return result?.sessions ?? []
}

// ── Log Streaming (Phase 2J) ──────────────────────────────────────────────────

export interface BridgeLogEntry {
  id: string
  timestamp: number
  level: 'info' | 'warn' | 'error' | 'debug'
  source: string
  session?: string
  message: string
  data?: any
}

/** Fetch up to `limit` recent log entries from the bridge ring buffer. */
export async function bridgeLogsRecent(limit = 200): Promise<BridgeLogEntry[]> {
  const result = await callOpenClawGateway<{ logs: BridgeLogEntry[] }>(
    'logs_recent', { limit }
  )
  return result?.logs ?? []
}
