'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { createClientLogger } from '@/lib/client-logger'
import type {
  BridgeContextPreviewResult,
  BridgeSessionDetail,
  BridgeAgentMessageResult,
} from '@/lib/mycelium-bridge'

const log = createClientLogger('AgentSquadPanel')

interface Agent {
  id: number | string
  name: string
  role: string
  session_key?: string
  soul_content?: string
  status: 'offline' | 'idle' | 'busy' | 'error'
  last_seen?: number
  last_activity?: string
  created_at: number
  updated_at: number
  config?: any
  taskStats?: {
    total: number
    assigned: number
    in_progress: number
    completed: number
  }
  runtime_type?: string
  // Mycelium bridge agent fields
  provider?: string
  model?: string
  bridge_id?: string
}

const statusColors: Record<string, string> = {
  offline: 'bg-gray-500',
  idle: 'bg-green-500',
  busy: 'bg-yellow-500',
  error: 'bg-red-500',
}

const statusIcons: Record<string, string> = {
  offline: '⚫',
  idle: '🟢',
  busy: '🟡',
  error: '🔴',
}

export function AgentSquadPanel() {
  const t = useTranslations('agentSquad')
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [selectedBridgeAgent, setSelectedBridgeAgent] = useState<Agent | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)

  // Fetch agents (MC SQLite + Mycelium bridge, merged)
  const fetchAgents = useCallback(async () => {
    try {
      setError(null)
      if (agents.length === 0) setLoading(true)

      const [mcRes, bridgeRes] = await Promise.allSettled([
        fetch('/api/agents'),
        fetch('/api/bridge/agents'),
      ])

      if (mcRes.status === 'rejected' || !mcRes.value.ok) {
        throw new Error(t('failedToFetch'))
      }

      const mcData = await mcRes.value.json()
      const mcAgents: Agent[] = mcData.agents || []

      // Bridge agents are optional — failure is non-fatal
      let bridgeAgents: Agent[] = []
      if (bridgeRes.status === 'fulfilled' && bridgeRes.value.ok) {
        const bridgeData = await bridgeRes.value.json()
        bridgeAgents = (bridgeData.agents || []).map((a: any) => ({
          id: `bridge:${a.id}`,
          bridge_id: a.id,
          name: a.name,
          role: a.model || '',
          status: (a.status as Agent['status']) || 'offline',
          runtime_type: 'mycelium',
          provider: a.provider,
          model: a.model,
          created_at: a.created_at ? Math.floor(new Date(a.created_at).getTime() / 1000) : 0,
          updated_at: a.updated_at ? Math.floor(new Date(a.updated_at).getTime() / 1000) : 0,
        }))
      }

      setAgents([...mcAgents, ...bridgeAgents])
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorOccurred'))
    } finally {
      setLoading(false)
    }
  }, [agents.length])

  // Initial load
  useEffect(() => {
    fetchAgents()
  }, [fetchAgents])

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return

    const interval = setInterval(fetchAgents, 10000) // Every 10 seconds
    return () => clearInterval(interval)
  }, [autoRefresh, fetchAgents])

  // Update agent status (MC agents only — bridge agents manage their own status)
  const updateAgentStatus = async (agentName: string, status: Agent['status'], activity?: string) => {
    try {
      const response = await fetch('/api/agents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: agentName,
          status,
          last_activity: activity || `Status changed to ${status}`
        })
      })

      if (!response.ok) throw new Error(t('failedToUpdateStatus'))

      // Update local state
      setAgents(prev => prev.map(agent =>
        agent.name === agentName
          ? {
              ...agent,
              status,
              last_activity: activity || `Status changed to ${status}`,
              last_seen: Math.floor(Date.now() / 1000),
              updated_at: Math.floor(Date.now() / 1000)
            }
          : agent
      ))
    } catch (error) {
      log.error('Failed to update agent status:', error)
      setError(t('failedToUpdateStatus'))
    }
  }

  // Format last seen time
  const formatLastSeen = (timestamp?: number) => {
    if (!timestamp) return t('never')

    const now = Date.now()
    const diffMs = now - (timestamp * 1000)
    const diffMinutes = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffMinutes < 1) return t('justNow')
    if (diffMinutes < 60) return t('minutesAgo', { count: diffMinutes })
    if (diffHours < 24) return t('hoursAgo', { count: diffHours })
    if (diffDays < 7) return t('daysAgo', { count: diffDays })
    
    return new Date(timestamp * 1000).toLocaleDateString()
  }

  // Get status distribution for summary
  const statusCounts = agents.reduce((acc, agent) => {
    acc[agent.status] = (acc[agent.status] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  if (loading && agents.length === 0) {
    return <Loader variant="panel" label={t('loadingAgents')} />
  }

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-gray-700">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-white">{t('title')}</h2>
          
          {/* Status Summary */}
          <div className="flex gap-2 text-sm">
            {Object.entries(statusCounts).map(([status, count]) => (
              <div key={status} className="flex items-center gap-1">
                <div className={`w-2 h-2 rounded-full ${statusColors[status]}`}></div>
                <span className="text-gray-400">{count}</span>
              </div>
            ))}
          </div>
        </div>
        
        <div className="flex gap-2">
          <Button
            onClick={() => setAutoRefresh(!autoRefresh)}
            variant={autoRefresh ? 'success' : 'secondary'}
            size="sm"
          >
            {autoRefresh ? t('live') : t('manual')}
          </Button>
          <Button
            onClick={() => setShowCreateModal(true)}
          >
            {t('addAgent')}
          </Button>
          <Button
            onClick={fetchAgents}
            variant="secondary"
          >
            {t('refresh')}
          </Button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-900/20 border border-red-500 text-red-400 p-3 m-4 rounded">
          {error}
          <Button
            onClick={() => setError(null)}
            variant="ghost"
            size="icon-sm"
            className="float-right text-red-300 hover:text-red-100"
          >
            ×
          </Button>
        </div>
      )}

      {/* Agent Grid */}
      <div className="flex-1 p-4 overflow-y-auto">
        {agents.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <div className="text-4xl mb-2">🤖</div>
            <p>{t('noAgents')}</p>
            <p className="text-sm">{t('addFirstAgent')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map(agent => (
              <div
                key={agent.id}
                className="bg-gray-800 rounded-lg p-4 border-l-4 border-gray-600 hover:bg-gray-750 transition-colors cursor-pointer"
                onClick={() => {
                  if (agent.runtime_type === 'mycelium') setSelectedBridgeAgent(agent)
                  else setSelectedAgent(agent)
                }}
              >
                {/* Agent Header */}
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-white text-lg">{agent.name}</h3>
                      {agent.runtime_type && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-1 text-muted-foreground border border-border/30">
                          {agent.runtime_type}
                        </span>
                      )}
                    </div>
                    <p className="text-gray-400 text-sm">{agent.role}</p>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${statusColors[agent.status]} animate-pulse`}></div>
                    <span className="text-xs text-gray-400">{agent.status}</span>
                  </div>
                </div>

                {/* Bridge agent: provider/model info */}
                {agent.runtime_type === 'mycelium' && agent.provider && (
                  <div className="text-xs text-gray-400 mb-2">
                    <span className="font-medium">{agent.provider}</span>
                    {agent.model && <span className="ml-1 text-gray-500 truncate" title={agent.model}> / {agent.model}</span>}
                  </div>
                )}

                {/* Session Info */}
                {agent.session_key && (
                  <div className="text-xs text-gray-400 mb-2">
                    <span className="font-medium">{t('session')}:</span> {agent.session_key}
                  </div>
                )}

                {/* Task Stats */}
                {agent.taskStats && (
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="bg-gray-700/50 rounded p-2 text-center">
                      <div className="text-lg font-semibold text-white">{agent.taskStats.total}</div>
                      <div className="text-xs text-gray-400">{t('totalTasks')}</div>
                    </div>
                    <div className="bg-gray-700/50 rounded p-2 text-center">
                      <div className="text-lg font-semibold text-yellow-400">{agent.taskStats.in_progress}</div>
                      <div className="text-xs text-gray-400">{t('inProgress')}</div>
                    </div>
                  </div>
                )}

                {/* Last Activity */}
                <div className="text-xs text-gray-400 mb-3">
                  <div>
                    <span className="font-medium">{t('lastSeen')}:</span> {formatLastSeen(agent.last_seen)}
                  </div>
                  {agent.last_activity && (
                    <div className="mt-1 truncate" title={agent.last_activity}>
                      <span className="font-medium">{t('activity')}:</span> {agent.last_activity}
                    </div>
                  )}
                </div>

                {/* Quick Actions — MC agents only */}
                {agent.runtime_type !== 'mycelium' && (
                  <div className="flex gap-1">
                    <Button
                      onClick={(e) => {
                        e.stopPropagation()
                        updateAgentStatus(agent.name, 'idle', 'Manually activated')
                      }}
                      disabled={agent.status === 'idle'}
                      variant="success"
                      size="xs"
                      className="flex-1"
                    >
                      {t('wake')}
                    </Button>
                    <Button
                      onClick={(e) => {
                        e.stopPropagation()
                        updateAgentStatus(agent.name, 'busy', 'Manually set to busy')
                      }}
                      disabled={agent.status === 'busy'}
                      size="xs"
                      className="flex-1 bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/30"
                    >
                      {t('busy')}
                    </Button>
                    <Button
                      onClick={(e) => {
                        e.stopPropagation()
                        updateAgentStatus(agent.name, 'offline', 'Manually set offline')
                      }}
                      disabled={agent.status === 'offline'}
                      variant="secondary"
                      size="xs"
                      className="flex-1"
                    >
                      {t('sleep')}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Agent Detail Modal */}
      {selectedAgent && (
        <AgentDetailModal
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
          onUpdate={fetchAgents}
          onStatusUpdate={updateAgentStatus}
        />
      )}

      {/* Mycelium Bridge Agent Message Modal */}
      {selectedBridgeAgent && (
        <BridgeAgentModal
          agent={selectedBridgeAgent}
          onClose={() => setSelectedBridgeAgent(null)}
        />
      )}

      {/* Create Agent Modal */}
      {showCreateModal && (
        <CreateAgentModal
          onClose={() => setShowCreateModal(false)}
          onCreated={fetchAgents}
        />
      )}
    </div>
  )
}

// Agent Detail Modal
function AgentDetailModal({
  agent,
  onClose,
  onUpdate,
  onStatusUpdate
}: {
  agent: Agent
  onClose: () => void
  onUpdate: () => void
  onStatusUpdate: (name: string, status: Agent['status'], activity?: string) => Promise<void>
}) {
  const t = useTranslations('agentSquad')
  const [editing, setEditing] = useState(false)
  const [formData, setFormData] = useState({
    role: agent.role,
    session_key: agent.session_key || '',
    soul_content: agent.soul_content || '',
  })

  const handleSave = async () => {
    try {
      const response = await fetch('/api/agents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: agent.name,
          ...formData
        })
      })

      if (!response.ok) throw new Error(t('failedToUpdate'))
      
      setEditing(false)
      onUpdate()
    } catch (error) {
      log.error('Failed to update agent:', error)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-xl font-bold text-white">{agent.name}</h3>
              <p className="text-gray-400">{agent.role}</p>
            </div>
            <div className="flex items-center gap-3">
              <div className={`w-4 h-4 rounded-full ${statusColors[agent.status]}`}></div>
              <span className="text-white">{agent.status}</span>
              <Button onClick={onClose} variant="ghost" size="icon-sm" className="text-2xl">×</Button>
            </div>
          </div>

          {/* Status Controls */}
          <div className="mb-6 p-4 bg-gray-700/50 rounded-lg">
            <h4 className="text-sm font-medium text-white mb-2">{t('statusControl')}</h4>
            <div className="flex gap-2">
              {(['idle', 'busy', 'offline'] as const).map(status => (
                <Button
                  key={status}
                  onClick={() => onStatusUpdate(agent.name, status)}
                  variant={agent.status === status ? 'default' : 'secondary'}
                  size="sm"
                >
                  {statusIcons[status]} {status}
                </Button>
              ))}
            </div>
          </div>

          {/* Agent Details */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">{t('role')}</label>
              {editing ? (
                <input
                  type="text"
                  value={formData.role}
                  onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value }))}
                  className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              ) : (
                <p className="text-white">{agent.role}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">{t('sessionKey')}</label>
              {editing ? (
                <input
                  type="text"
                  value={formData.session_key}
                  onChange={(e) => setFormData(prev => ({ ...prev, session_key: e.target.value }))}
                  className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              ) : (
                <p className="text-white font-mono">{agent.session_key || t('notSet')}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">{t('soulContent')}</label>
              {editing ? (
                <textarea
                  value={formData.soul_content}
                  onChange={(e) => setFormData(prev => ({ ...prev, soul_content: e.target.value }))}
                  rows={4}
                  className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={t('soulPlaceholder')}
                />
              ) : (
                <p className="text-white whitespace-pre-wrap">{agent.soul_content || t('notSet')}</p>
              )}
            </div>

            {/* Task Statistics */}
            {agent.taskStats && (
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">{t('taskStatistics')}</label>
                <div className="grid grid-cols-4 gap-2">
                  <div className="bg-gray-700/50 rounded p-3 text-center">
                    <div className="text-lg font-semibold text-white">{agent.taskStats.total}</div>
                    <div className="text-xs text-gray-400">{t('total')}</div>
                  </div>
                  <div className="bg-gray-700/50 rounded p-3 text-center">
                    <div className="text-lg font-semibold text-blue-400">{agent.taskStats.assigned}</div>
                    <div className="text-xs text-gray-400">{t('assigned')}</div>
                  </div>
                  <div className="bg-gray-700/50 rounded p-3 text-center">
                    <div className="text-lg font-semibold text-yellow-400">{agent.taskStats.in_progress}</div>
                    <div className="text-xs text-gray-400">{t('inProgress')}</div>
                  </div>
                  <div className="bg-gray-700/50 rounded p-3 text-center">
                    <div className="text-lg font-semibold text-green-400">{agent.taskStats.completed}</div>
                    <div className="text-xs text-gray-400">{t('done')}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Timestamps */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-400">{t('created')}:</span>
                <span className="text-white ml-2">{new Date(agent.created_at * 1000).toLocaleDateString()}</span>
              </div>
              <div>
                <span className="text-gray-400">{t('lastUpdated')}:</span>
                <span className="text-white ml-2">{new Date(agent.updated_at * 1000).toLocaleDateString()}</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 mt-6">
            {editing ? (
              <>
                <Button
                  onClick={handleSave}
                  className="flex-1"
                >
                  {t('saveChanges')}
                </Button>
                <Button
                  onClick={() => setEditing(false)}
                  variant="secondary"
                  className="flex-1"
                >
                  {t('cancel')}
                </Button>
              </>
            ) : (
              <Button
                onClick={() => setEditing(true)}
                className="flex-1"
              >
                {t('editAgent')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── BridgeAgentModal ──────────────────────────────────────────────────────────

interface ChatEntry {
  role: 'user' | 'assistant' | 'status'
  text: string
}

function BridgeAgentModal({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [tab, setTab] = useState<'chat' | 'debug'>('chat')
  const [sessionId, setSessionId] = useState<string | null>(null)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg w-full max-w-2xl flex flex-col" style={{ height: '80vh' }}>
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-gray-700 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-white">{agent.name}</h3>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-1 text-muted-foreground border border-border/30">
                mycelium
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              {agent.provider} / {agent.model}
            </p>
          </div>
          <Button onClick={onClose} variant="ghost" size="icon-sm" className="text-2xl">
            ×
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700 shrink-0">
          <button
            onClick={() => setTab('chat')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === 'chat'
                ? 'text-white border-b-2 border-blue-500'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Chat
          </button>
          <button
            onClick={() => setTab('debug')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === 'debug'
                ? 'text-white border-b-2 border-blue-500'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Debug / Context Preview
          </button>
        </div>

        {/* Tab content */}
        {tab === 'chat' ? (
          <BridgeChatPane agent={agent} sessionId={sessionId} onSessionId={setSessionId} />
        ) : (
          <BridgeDebugPane agent={agent} sessionId={sessionId} />
        )}
      </div>
    </div>
  )
}

// ── Chat pane ─────────────────────────────────────────────────────────────────

function BridgeChatPane({
  agent,
  sessionId,
  onSessionId,
}: {
  agent: Agent
  sessionId: string | null
  onSessionId: (id: string) => void
}) {
  const [history, setHistory] = useState<ChatEntry[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history, sending])

  const handleSend = async () => {
    const msg = input.trim()
    if (!msg || sending) return
    setInput('')
    setSendError(null)
    setHistory((h) => [...h, { role: 'user', text: msg }])
    setSending(true)

    try {
      const response = await fetch('/api/bridge/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: agent.bridge_id,
          session_id: sessionId || undefined,
          message: msg,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to send')

      onSessionId(data.session_id)
      if (data.status === 'failed') {
        setHistory((h) => [
          ...h,
          { role: 'status', text: `Error: ${data.error || 'Provider error'}` },
        ])
      } else {
        setHistory((h) => [
          ...h,
          { role: 'assistant', text: data.response_text || '(empty response)' },
        ])
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Error sending message'
      setSendError(errMsg)
      setHistory((h) => h.slice(0, -1))
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {history.length === 0 && (
          <p className="text-gray-500 text-sm text-center pt-8">
            Send a message to start a conversation with this agent.
          </p>
        )}
        {history.map((entry, i) => (
          <div
            key={i}
            className={`flex ${entry.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                entry.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : entry.role === 'status'
                    ? 'bg-red-900/40 text-red-300 border border-red-700/40'
                    : 'bg-gray-700 text-gray-100'
              }`}
            >
              {entry.text}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-gray-700 rounded-lg px-3 py-2 text-sm text-gray-400 animate-pulse">
              Thinking...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {sendError && (
        <div className="mx-4 mb-2 bg-red-900/30 border border-red-500 text-red-300 text-xs rounded px-3 py-2 shrink-0">
          {sendError}
          <Button
            onClick={() => setSendError(null)}
            variant="ghost"
            size="icon-sm"
            className="float-right text-red-300 hover:text-red-100"
          >
            ×
          </Button>
        </div>
      )}

      <div className="p-4 border-t border-gray-700 shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sending}
            rows={2}
            placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
            className="flex-1 bg-gray-700 text-white rounded px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          <Button onClick={handleSend} disabled={sending || !input.trim()} className="shrink-0">
            {sending ? '...' : 'Send'}
          </Button>
        </div>
        {sessionId && (
          <p className="text-xs text-gray-600 mt-1 font-mono truncate" title={sessionId}>
            session: {sessionId}
          </p>
        )}
      </div>
    </>
  )
}

// ── Debug pane ────────────────────────────────────────────────────────────────

function BridgeDebugPane({ agent, sessionId }: { agent: Agent; sessionId: string | null }) {
  const [draftMessage, setDraftMessage] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [previewResult, setPreviewResult] = useState<BridgeContextPreviewResult | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [showFullText, setShowFullText] = useState(false)

  const [sessionLoading, setSessionLoading] = useState(false)
  const [sessionDetail, setSessionDetail] = useState<BridgeSessionDetail | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)

  const handlePreview = async () => {
    if (previewing) return
    setPreviewing(true)
    setPreviewError(null)
    setPreviewResult(null)
    try {
      const response = await fetch('/api/bridge/context-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: agent.bridge_id,
          session_id: sessionId || undefined,
          message: draftMessage || undefined,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Preview failed')
      setPreviewResult(data)
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'Preview failed')
    } finally {
      setPreviewing(false)
    }
  }

  const handleLoadSession = async () => {
    if (!sessionId || sessionLoading) return
    setSessionLoading(true)
    setSessionError(null)
    try {
      const response = await fetch(`/api/bridge/sessions/${sessionId}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to load session')
      setSessionDetail(data)
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : 'Failed to load session')
    } finally {
      setSessionLoading(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6 text-sm">

      {/* Context Preview */}
      <section>
        <h4 className="text-white font-semibold mb-3">Context Preview</h4>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={draftMessage}
            onChange={(e) => setDraftMessage(e.target.value)}
            placeholder="Optional: draft message for knowledge search…"
            className="flex-1 bg-gray-700 text-white rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            onKeyDown={(e) => { if (e.key === 'Enter') handlePreview() }}
          />
          <Button onClick={handlePreview} disabled={previewing} size="sm">
            {previewing ? 'Loading…' : 'Preview Context'}
          </Button>
        </div>

        {previewError && (
          <div className="text-red-400 bg-red-900/20 border border-red-700/40 rounded px-3 py-2 text-xs mb-3">
            {previewError}
          </div>
        )}

        {previewResult && (
          <div className="space-y-3">
            {/* Section token breakdown */}
            <div className="bg-gray-900 rounded p-3">
              <p className="text-gray-400 text-xs mb-2 font-mono">
                {agent.provider} / {previewResult.model}
              </p>
              <div className="space-y-1">
                {previewResult.sections.map((s, i) => (
                  <div key={i} className="flex justify-between font-mono text-xs">
                    <span className={s.skipped ? 'text-gray-600' : 'text-gray-300'}>
                      {s.name}{s.skipped ? ' (skipped)' : ''}
                      {s.reason && <span className="text-gray-600 ml-1">— {s.reason}</span>}
                    </span>
                    <span className={s.skipped ? 'text-gray-600' : 'text-blue-400'}>
                      {s.skipped ? '—' : `~${s.tokens} tok`}
                    </span>
                  </div>
                ))}
                <div className="border-t border-gray-700 mt-2 pt-1 flex justify-between font-mono text-xs font-semibold">
                  <span className="text-gray-300">total</span>
                  <span className="text-blue-300">~{previewResult.total_tokens} tok</span>
                </div>
              </div>
            </div>

            {/* Injected knowledge docs */}
            {previewResult.knowledge_docs?.length > 0 && (
              <div className="bg-gray-900 rounded p-3">
                <p className="text-gray-400 text-xs font-semibold mb-2">Injected Knowledge</p>
                {previewResult.knowledge_docs.map((doc, i) => (
                  <div key={i} className="flex justify-between text-xs text-gray-300 py-0.5">
                    <span>{doc.title}</span>
                    <span className="text-gray-500">{doc.scope}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Warnings */}
            {previewResult.warnings?.length > 0 && (
              <div className="text-yellow-400 bg-yellow-900/20 border border-yellow-700/40 rounded px-3 py-2 text-xs">
                {previewResult.warnings.map((w, i) => <div key={i}>{w}</div>)}
              </div>
            )}

            {/* Full assembled text (collapsible) */}
            <div>
              <button
                onClick={() => setShowFullText(!showFullText)}
                className="text-xs text-blue-400 hover:text-blue-300 mb-2"
              >
                {showFullText ? 'Hide' : 'Show'} assembled system prompt
              </button>
              {showFullText && (
                <pre className="bg-gray-900 rounded p-3 text-xs text-gray-300 whitespace-pre-wrap break-words max-h-64 overflow-y-auto font-mono">
                  {previewResult.full_text || '(empty)'}
                </pre>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Session Viewer */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-white font-semibold">Session Viewer</h4>
          {sessionId ? (
            <Button onClick={handleLoadSession} disabled={sessionLoading} size="sm" variant="secondary">
              {sessionLoading ? 'Loading…' : 'Load Session'}
            </Button>
          ) : (
            <span className="text-gray-500 text-xs">No session yet — send a message first</span>
          )}
        </div>

        {sessionError && (
          <div className="text-red-400 bg-red-900/20 border border-red-700/40 rounded px-3 py-2 text-xs">
            {sessionError}
          </div>
        )}

        {sessionDetail && (
          <div className="space-y-3">
            {/* Session meta */}
            <div className="bg-gray-900 rounded p-3 text-xs font-mono text-gray-400 space-y-1">
              <div><span className="text-gray-600">id:</span> {sessionDetail.session_id}</div>
              <div><span className="text-gray-600">status:</span> {sessionDetail.status}</div>
              <div>
                <span className="text-gray-600">tokens:</span>{' '}
                <span className="text-blue-400">
                  {sessionDetail.total_input_tokens} in / {sessionDetail.total_output_tokens} out
                </span>
              </div>
              {sessionDetail.session_notes && (
                <div>
                  <span className="text-gray-600">notes:</span>{' '}
                  <span className="text-gray-300">{sessionDetail.session_notes}</span>
                </div>
              )}
            </div>

            {/* Message history */}
            {sessionDetail.messages.length > 0 && (
              <div className="space-y-2">
                <p className="text-gray-500 text-xs">
                  {sessionDetail.messages.length} message{sessionDetail.messages.length !== 1 ? 's' : ''}
                </p>
                {sessionDetail.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`rounded px-3 py-2 text-xs whitespace-pre-wrap break-words ${
                      m.role === 'user'
                        ? 'bg-blue-900/30 border border-blue-700/40 text-blue-200'
                        : 'bg-gray-700/50 text-gray-300'
                    }`}
                  >
                    <span className="font-semibold text-gray-500 mr-2">{m.role}:</span>
                    {m.content}
                  </div>
                ))}
              </div>
            )}

            {/* Tasks */}
            {sessionDetail.tasks.length > 0 && (
              <div>
                <p className="text-gray-500 text-xs mb-1">
                  {sessionDetail.tasks.length} task{sessionDetail.tasks.length !== 1 ? 's' : ''}
                </p>
                {sessionDetail.tasks.map((t) => (
                  <div key={t.id} className="flex justify-between font-mono text-xs text-gray-400 py-0.5">
                    <span className="truncate max-w-[60%]" title={t.id}>{t.id.slice(0, 12)}…</span>
                    <span className={
                      t.status === 'completed' ? 'text-green-400' :
                      t.status === 'failed' ? 'text-red-400' :
                      t.status === 'streaming' ? 'text-yellow-400' : 'text-gray-500'
                    }>{t.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Agent → Agent */}
      <AgentToAgentPane fromAgentId={agent.bridge_id!} />
    </div>
  )
}

// ── Agent → Agent pane ────────────────────────────────────────────────────────

function AgentToAgentPane({ fromAgentId }: { fromAgentId: string }) {
  const [toAgentId, setToAgentId] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<BridgeAgentMessageResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([])

  // Load available bridge agents for the target selector.
  useEffect(() => {
    fetch('/api/bridge/agents')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.agents) {
          setAgents(
            data.agents
              .filter((a: any) => a.id !== fromAgentId && a.framework === 'mycelium')
              .map((a: any) => ({ id: a.id, name: a.name }))
          )
        }
      })
      .catch(() => {})
  }, [fromAgentId])

  const handleSend = async () => {
    if (!toAgentId || !message.trim() || sending) return
    setSending(true)
    setError(null)
    setResult(null)
    try {
      const response = await fetch('/api/bridge/agents/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_agent_id: fromAgentId,
          to_agent_id: toAgentId,
          message: message.trim(),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed')
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSending(false)
    }
  }

  return (
    <section>
      <h4 className="text-white font-semibold mb-3">Agent → Agent</h4>

      <div className="space-y-2 mb-3">
        <div className="flex gap-2">
          <select
            value={toAgentId}
            onChange={(e) => setToAgentId(e.target.value)}
            className="flex-1 bg-gray-700 text-white rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select target agent…</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.id})</option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Message to send…"
            className="flex-1 bg-gray-700 text-white rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            onKeyDown={(e) => { if (e.key === 'Enter') handleSend() }}
          />
          <Button onClick={handleSend} disabled={!toAgentId || !message.trim() || sending} size="sm">
            {sending ? '…' : 'Send'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="text-red-400 bg-red-900/20 border border-red-700/40 rounded px-3 py-2 text-xs mb-2">
          {error}
        </div>
      )}

      {result && (
        <div className="bg-gray-900 rounded p-3 text-xs space-y-2">
          <div className="text-gray-300 whitespace-pre-wrap break-words">{result.response_text}</div>
          <div className="flex gap-4 text-gray-500 font-mono pt-1 border-t border-gray-700">
            <span>{result.input_tokens} in</span>
            <span>{result.output_tokens} out</span>
            <span className="truncate" title={result.session_id}>session: {result.session_id.slice(0, 12)}…</span>
          </div>
        </div>
      )}
    </section>
  )
}

// ── CreateAgentModal ──────────────────────────────────────────────────────────

const MYCELIUM_DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b:free'

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// Create Agent Modal
function CreateAgentModal({
  onClose,
  onCreated
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const t = useTranslations('agentSquad')
  const [formData, setFormData] = useState({
    name: '',
    role: '',
    session_key: '',
    soul_content: '',
    runtime_type: '' as string,
    // Mycelium-specific
    bridge_id: '',
    provider: 'openrouter',
    model: MYCELIUM_DEFAULT_MODEL,
    system_prompt: '',
  })
  const [createError, setCreateError] = useState<string | null>(null)

  const isMyceli = formData.runtime_type === 'mycelium'

  // Auto-fill bridge_id from name when not manually set
  const handleNameChange = (name: string) => {
    setFormData(prev => ({
      ...prev,
      name,
      bridge_id: prev.bridge_id === slugify(prev.name) || prev.bridge_id === '' ? slugify(name) : prev.bridge_id,
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError(null)

    try {
      if (isMyceli) {
        const id = formData.bridge_id || slugify(formData.name)
        const response = await fetch('/api/bridge/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id,
            name: formData.name,
            provider: formData.provider,
            model: formData.model,
            system_prompt: formData.system_prompt || undefined,
            channels: ['dashboard'],
            status: 'online',
          }),
        })
        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || t('failedToCreate'))
        }
      } else {
        const response = await fetch('/api/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formData.name,
            role: formData.role,
            session_key: formData.session_key || undefined,
            soul_content: formData.soul_content || undefined,
            runtime_type: formData.runtime_type || undefined,
          }),
        })
        if (!response.ok) throw new Error(t('failedToCreate'))
      }

      onCreated()
      onClose()
    } catch (error) {
      log.error('Error creating agent:', error)
      setCreateError(error instanceof Error ? error.message : t('failedToCreate'))
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit} className="p-6">
          <h3 className="text-xl font-bold text-white mb-4">{t('createNewAgent')}</h3>

          {createError && (
            <div className="bg-red-900/30 border border-red-500 text-red-300 text-sm rounded px-3 py-2 mb-4">
              {createError}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">{t('name')}</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => handleNameChange(e.target.value)}
                className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">{t('runtimeType')}</label>
              <select
                value={formData.runtime_type}
                onChange={(e) => setFormData(prev => ({ ...prev, runtime_type: e.target.value }))}
                className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">{t('runtimeTypeAuto')}</option>
                <option value="mycelium">Mycelium (Bridge)</option>
                <option value="hermes">Hermes Agent</option>
                <option value="openclaw">OpenClaw</option>
                <option value="claude">Claude Code</option>
                <option value="codex">Codex CLI</option>
                <option value="custom">{t('runtimeTypeCustom')}</option>
              </select>
            </div>

            {/* Mycelium-specific fields */}
            {isMyceli && (
              <>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Agent ID</label>
                  <input
                    type="text"
                    value={formData.bridge_id}
                    onChange={(e) => setFormData(prev => ({ ...prev, bridge_id: e.target.value }))}
                    className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                    placeholder="auto-generated from name"
                  />
                  <p className="text-xs text-gray-500 mt-1">Unique identifier (lowercase, hyphens)</p>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">Provider</label>
                  <select
                    value={formData.provider}
                    onChange={(e) => setFormData(prev => ({ ...prev, provider: e.target.value }))}
                    className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  >
                    <option value="openrouter">OpenRouter</option>
                    <option value="claude">Claude (Anthropic)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">Model</label>
                  <input
                    type="text"
                    value={formData.model}
                    onChange={(e) => setFormData(prev => ({ ...prev, model: e.target.value }))}
                    className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                    placeholder={MYCELIUM_DEFAULT_MODEL}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">System Prompt (optional)</label>
                  <textarea
                    value={formData.system_prompt}
                    onChange={(e) => setFormData(prev => ({ ...prev, system_prompt: e.target.value }))}
                    className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={3}
                    placeholder="You are a helpful assistant."
                  />
                </div>
              </>
            )}

            {/* Standard MC agent fields */}
            {!isMyceli && (
              <>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">{t('role')}</label>
                  <input
                    type="text"
                    value={formData.role}
                    onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value }))}
                    className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={t('rolePlaceholder')}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">{t('sessionKeyOptional')}</label>
                  <input
                    type="text"
                    value={formData.session_key}
                    onChange={(e) => setFormData(prev => ({ ...prev, session_key: e.target.value }))}
                    className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={t('sessionKeyPlaceholder')}
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">{t('soulContentOptional')}</label>
                  <textarea
                    value={formData.soul_content}
                    onChange={(e) => setFormData(prev => ({ ...prev, soul_content: e.target.value }))}
                    className="w-full bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={3}
                    placeholder={t('soulPlaceholder')}
                  />
                </div>
              </>
            )}
          </div>

          <div className="flex gap-3 mt-6">
            <Button
              type="submit"
              className="flex-1"
            >
              {t('createAgent')}
            </Button>
            <Button
              type="button"
              onClick={onClose}
              variant="secondary"
              className="flex-1"
            >
              {t('cancel')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}