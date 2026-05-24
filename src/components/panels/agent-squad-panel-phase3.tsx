'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { createClientLogger } from '@/lib/client-logger'
import { AgentAvatar } from '@/components/ui/agent-avatar'
import {
  OverviewTab,
  SoulTab,
  MemoryTab,
  TasksTab,
  ActivityTab,
  ConfigTab,
  FilesTab,
  ToolsTab,
  ChannelsTab,
  CronTab,
  ModelsTab,
  CreateAgentModal
} from './agent-detail-tabs'
import { formatModelName, buildTaskStatParts } from '@/lib/agent-card-helpers'
import { useMissionControl, type Agent } from '@/store'

const log = createClientLogger('AgentSquadPhase3')

interface WorkItem {
  type: string
  count: number
  items: any[]
}

interface HeartbeatResponse {
  status: 'HEARTBEAT_OK' | 'WORK_ITEMS_FOUND'
  agent: string
  checked_at: number
  work_items?: WorkItem[]
  total_items?: number
  message?: string
}

interface SoulTemplate {
  name: string
  description: string
  size: number
}

const statusColors: Record<string, string> = {
  offline: 'bg-gray-500',
  idle: 'bg-green-500',
  busy: 'bg-yellow-500',
  error: 'bg-red-500',
}

const statusBadgeStyles: Record<string, string> = {
  offline: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  idle: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  busy: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  error: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
}

const statusIcons: Record<string, string> = {
  offline: '-',
  idle: 'o',
  busy: '~',
  error: '!',
}

const defaultCardStyle = {
  edge: 'from-slate-400/60 to-slate-600/30',
  glow: 'from-slate-500/10 via-transparent to-transparent',
  dot: 'bg-slate-400',
}

const statusCardStyles: Record<string, { edge: string; glow: string; dot: string }> = {
  offline: defaultCardStyle,
  idle: {
    edge: 'from-emerald-300/80 to-emerald-600/30',
    glow: 'from-emerald-400/15 via-transparent to-transparent',
    dot: 'bg-emerald-300',
  },
  busy: {
    edge: 'from-amber-300/80 to-amber-600/30',
    glow: 'from-amber-400/15 via-transparent to-transparent',
    dot: 'bg-amber-300',
  },
  error: {
    edge: 'from-rose-300/80 to-rose-600/30',
    glow: 'from-rose-400/15 via-transparent to-transparent',
    dot: 'bg-rose-300',
  },
}

export function AgentSquadPanelPhase3() {
  const t = useTranslations('agentSquadPhase3')
  const { agents, setAgents } = useMissionControl()
  const [loading, setLoading] = useState(agents.length === 0)
  const [error, setError] = useState<string | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showQuickSpawnModal, setShowQuickSpawnModal] = useState(false)
  const [bridgeAgents, setBridgeAgents] = useState<BridgeAgentView[]>([])
  const [bridgeTokens, setBridgeTokens] = useState<Record<string, { input: number; output: number; tasks: number }>>({})
  const [selectedBridgeAgent, setSelectedBridgeAgent] = useState<BridgeAgentView | null>(null)
  const [editingBridgeAgent, setEditingBridgeAgent] = useState<BridgeAgentView | null>(null)
  const [showCreateBridgeModal, setShowCreateBridgeModal] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncToast, setSyncToast] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)

  // Sync agents from gateway config or local disk
  const syncFromConfig = async (source?: 'local') => {
    setSyncing(true)
    setSyncToast(null)
    try {
      const url = source === 'local' ? '/api/agents/sync?source=local' : '/api/agents/sync'
      const response = await fetch(url, { method: 'POST' })
      if (response.status === 401) {
        window.location.assign('/login?next=%2Fagents')
        return
      }
      const data = await response.json()
      if (response.status === 403) {
        throw new Error('Admin access required for agent sync')
      }
      if (!response.ok) throw new Error(data.error || 'Sync failed')
      if (source === 'local') {
        setSyncToast(data.message || 'Local agent sync complete')
      } else {
        setSyncToast(`Synced ${data.synced} agents (${data.created} new, ${data.updated} updated)`)
      }
      fetchAgents()
      setTimeout(() => setSyncToast(null), 5000)
    } catch (err: any) {
      setSyncToast(`Sync failed: ${err.message}`)
      setTimeout(() => setSyncToast(null), 5000)
    } finally {
      setSyncing(false)
    }
  }

  // Fetch agents
  const fetchAgents = useCallback(async () => {
    try {
      setError(null)
      if (agents.length === 0) setLoading(true)

      const url = showHidden ? '/api/agents?show_hidden=true' : '/api/agents'
      const response = await fetch(url)
      if (response.status === 401) {
        window.location.assign('/login?next=%2Fagents')
        return
      }
      if (response.status === 403) {
        throw new Error('Access denied')
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to fetch agents')
      }

      const data = await response.json()
      setAgents(data.agents || [])

      // Fetch Mycelium bridge agents + token usage in parallel — failure is non-fatal
      try {
        const [bridgeRes, costRes] = await Promise.all([
          fetch('/api/bridge/agents'),
          fetch('/api/bridge/cost'),
        ])
        if (bridgeRes.ok) {
          const bData = await bridgeRes.json()
          setBridgeAgents(bData.agents || [])
        }
        if (costRes.ok) {
          const cData = await costRes.json()
          const map: Record<string, { input: number; output: number; tasks: number }> = {}
          for (const a of (cData.agents || [])) {
            map[a.agent_id] = { input: a.input_tokens, output: a.output_tokens, tasks: a.task_count }
          }
          setBridgeTokens(map)
        }
      } catch {
        // Bridge unavailable — keep showing existing bridge agents
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [agents.length, setAgents, showHidden])

  // Smart polling with visibility pause
  useSmartPoll(fetchAgents, 30000, { enabled: autoRefresh, pauseWhenSseConnected: true })

  // Update agent status
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

      if (!response.ok) throw new Error('Failed to update agent status')
      
      // Update store state
      setAgents(agents.map(agent =>
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
      setError('Failed to update agent status')
    }
  }

  // Wake agent via session_send
  const wakeAgent = async (agentName: string, sessionKey: string) => {
    try {
      const response = await fetch(`/api/agents/${agentName}/wake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `🤖 **Wake Up Call**\n\nAgent ${agentName}, you have been manually woken up.\nCheck Mission Control for any pending tasks or notifications.\n\n⏰ ${new Date().toLocaleString()}`
        })
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to wake agent')
      }

      await updateAgentStatus(agentName, 'idle', 'Manually woken via session')
    } catch (error) {
      log.error('Failed to wake agent:', error)
      setError('Failed to wake agent')
    }
  }

  // Re-fetch when showHidden changes
  useEffect(() => {
    fetchAgents()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHidden])

  const toggleAgentHidden = async (agentId: number, hide: boolean) => {
    try {
      const response = await fetch(`/api/agents/${agentId}/hide`, {
        method: hide ? 'POST' : 'DELETE',
      })
      if (!response.ok) throw new Error('Failed to update visibility')
      fetchAgents()
    } catch (error) {
      log.error('Failed to toggle agent visibility:', error)
      setError('Failed to update agent visibility')
    }
  }

  const deleteAgent = async (agentId: number, removeWorkspace: boolean) => {
    const previousAgents = agents
    setAgents(agents.filter((agent) => agent.id !== agentId))

    const response = await fetch(`/api/agents/${agentId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remove_workspace: removeWorkspace }),
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      setAgents(previousAgents)
      throw new Error(payload?.error || 'Failed to delete agent')
    }

    setSyncToast(
      removeWorkspace
        ? `Deleted agent and workspace: ${payload?.deleted || agentId}`
        : `Deleted agent: ${payload?.deleted || agentId}`,
    )
    await fetchAgents()
    setTimeout(() => setSyncToast(null), 5000)
  }

  // Format last seen time
  const formatLastSeen = (timestamp?: number) => {
    if (!timestamp) return 'Never'
    
    const now = Date.now()
    const diffMs = now - (timestamp * 1000)
    const diffMinutes = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffMinutes < 1) return 'Just now'
    if (diffMinutes < 60) return `${diffMinutes}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    
    return new Date(timestamp * 1000).toLocaleDateString()
  }

  // Check if agent had recent heartbeat (within 30 minutes)
  const hasRecentHeartbeat = (agent: Agent) => {
    if (!agent.last_seen) return false
    const thirtyMinutesAgo = Math.floor(Date.now() / 1000) - (30 * 60)
    return agent.last_seen > thirtyMinutesAgo
  }

  // Get status distribution for summary
  const statusCounts = agents.reduce((acc, agent) => {
    acc[agent.status] = (acc[agent.status] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  if (loading && agents.length === 0 && bridgeAgents.length === 0) {
    return <Loader variant="panel" label="Loading agents" />
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-foreground">{t('title')}</h2>
          
          {/* Status Summary */}
          <div className="flex gap-2 text-sm">
            {Object.entries(statusCounts).map(([status, count]) => (
              <div key={status} className="flex items-center gap-1">
                <div className={`w-2 h-2 rounded-full ${statusColors[status]}`}></div>
                <span className="text-muted-foreground">{count}</span>
              </div>
            ))}
          </div>

          {/* Active Heartbeats Indicator */}
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></div>
            <span className="text-sm text-muted-foreground">
              {t('activeHeartbeats', { count: agents.filter(hasRecentHeartbeat).length })}
            </span>
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
            onClick={() => syncFromConfig()}
            disabled={syncing}
            size="sm"
            className="bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30"
          >
            {syncing ? t('syncing') : t('syncConfig')}
          </Button>
          <Button
            onClick={() => syncFromConfig('local')}
            disabled={syncing}
            size="sm"
            className="bg-violet-500/20 text-violet-400 border border-violet-500/30 hover:bg-violet-500/30"
          >
            {t('syncLocal')}
          </Button>
          <Button
            onClick={() => setShowHidden(!showHidden)}
            variant={showHidden ? 'success' : 'secondary'}
            size="sm"
          >
            {showHidden ? 'Showing hidden' : 'Show hidden'}
          </Button>
          <Button
            onClick={() => setShowCreateModal(true)}
            size="sm"
          >
            {t('addAgent')}
          </Button>
          <Button
            onClick={() => setShowCreateBridgeModal(true)}
            size="sm"
            className="bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500/30"
          >
            + Mycelium
          </Button>
          <Button
            onClick={fetchAgents}
            variant="secondary"
            size="sm"
          >
            {t('refresh')}
          </Button>
        </div>
      </div>

      {/* Sync Toast */}
      {syncToast && (
        <div className={`p-3 m-4 rounded-lg text-sm ${syncToast.includes('failed') ? 'bg-red-500/10 border border-red-500/20 text-red-400' : 'bg-green-500/10 border border-green-500/20 text-green-400'}`}>
          {syncToast}
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 m-4 rounded-lg text-sm flex items-center justify-between">
          <span>{error}</span>
          <Button
            onClick={() => setError(null)}
            variant="ghost"
            size="icon-sm"
            className="text-red-400/60 hover:text-red-400 ml-2"
          >
            ×
          </Button>
        </div>
      )}

      {/* Agent Grid */}
      <div className="flex-1 p-4 overflow-y-auto">
        {agents.length === 0 && bridgeAgents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/50">
            <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center mb-3">
              <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="8" cy="5" r="3" />
                <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" />
              </svg>
            </div>
            <p className="text-sm font-medium">{t('noAgents')}</p>
            <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs text-center">
              {t('noAgentsHint')}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Mycelium Bridge agent cards */}
            {bridgeAgents.map(ba => (
              <div
                key={`bridge:${ba.id}`}
                className="group relative overflow-hidden rounded-xl border border-violet-500/30 bg-card p-4 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-violet-400/50 hover:shadow-lg cursor-pointer"
                onClick={() => setSelectedBridgeAgent(ba)}
              >
                <div className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-violet-300/80 to-violet-600/30" />
                {/* Header */}
                <div className="flex items-start justify-between mb-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h3 className="font-semibold text-foreground truncate">{ba.name}</h3>
                      <span className="text-2xs px-1.5 py-0.5 rounded-full border bg-violet-500/15 text-violet-300 border-violet-500/30 shrink-0">
                        mycelium
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate font-mono">{ba.provider} / {ba.model}</p>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs capitalize shrink-0 ${statusBadgeStyles[ba.status] || statusBadgeStyles.offline}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${(statusCardStyles[ba.status] || defaultCardStyle).dot}`} />
                    {ba.status}
                  </span>
                </div>
                {/* Token usage */}
                {bridgeTokens[ba.id] && (
                  <div className="flex items-center gap-2 mt-2 text-[10px] text-violet-300/50">
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M8 2v12M4 6l4-4 4 4M4 10l4 4 4-4" />
                    </svg>
                    <span title={`↑ ${bridgeTokens[ba.id].input.toLocaleString()} in  ↓ ${bridgeTokens[ba.id].output.toLocaleString()} out`}>
                      {((bridgeTokens[ba.id].input + bridgeTokens[ba.id].output) / 1000).toFixed(1)}k tokens
                    </span>
                    <span className="text-violet-300/30">·</span>
                    <span>{bridgeTokens[ba.id].tasks} tasks</span>
                  </div>
                )}
                {/* Footer */}
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-violet-500/20">
                  <span className="text-[11px] text-violet-400/70">Click to message</span>
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); setEditingBridgeAgent(ba) }}
                    className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors px-1"
                  >
                    Edit
                  </button>
                </div>
              </div>
            ))}

            {agents.map(agent => {
              const modelName = formatModelName(agent.config)
              const taskStatsLine = buildTaskStatParts(agent.taskStats)

              return (
                <div
                  key={agent.id}
                  className="group relative overflow-hidden rounded-xl border border-border/70 bg-card p-4 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-border hover:shadow-lg cursor-pointer"
                  onClick={() => setSelectedAgent(agent)}
                >
                  <div className={`pointer-events-none absolute inset-y-0 left-0 w-1 bg-gradient-to-b ${(statusCardStyles[agent.status] || defaultCardStyle).edge}`} />
                  {agent.hidden ? <div className="absolute top-2 right-2 text-2xs text-slate-500">hidden</div> : null}

                  {/* Header: avatar + name + status */}
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <AgentAvatar name={agent.name} size="md" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h3 className="font-semibold text-foreground truncate">{agent.name}</h3>
                          {(agent as any).source && (agent as any).source !== 'manual' && (
                            <span className={`text-2xs px-1.5 py-0.5 rounded-full border ${
                              (agent as any).source === 'local'
                                ? 'bg-violet-500/15 text-violet-300 border-violet-500/30'
                                : (agent as any).source === 'gateway'
                                  ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                                  : 'bg-slate-500/15 text-slate-300 border-slate-500/30'
                            }`}>
                              {(agent as any).source}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {agent.role}{modelName && <> · <span className="font-mono text-muted-foreground/80">{modelName}</span></>}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {hasRecentHeartbeat(agent) && (
                        <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" title="Recent heartbeat" />
                      )}
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs capitalize ${statusBadgeStyles[agent.status]}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${(statusCardStyles[agent.status] || defaultCardStyle).dot}`} />
                        {agent.status}
                      </span>
                    </div>
                  </div>

                  {/* Task stats — inline */}
                  {taskStatsLine && (
                    <div className="text-xs text-muted-foreground mb-2 pl-0.5">
                      {taskStatsLine.map((part, i) => (
                        <span key={part.label}>
                          {i > 0 && <span className="mx-1 text-muted-foreground/40">·</span>}
                          <span className={part.color || 'text-foreground/80'}>{part.count}</span>
                          {' '}{part.label}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Footer: last seen + actions */}
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/30">
                    <span className="text-[11px] text-muted-foreground/70">
                      {formatLastSeen(agent.last_seen)}
                    </span>
                    <div className="flex gap-1">
                      {agent.session_key ? (
                        <Button
                          onClick={(e) => {
                            e.stopPropagation()
                            wakeAgent(agent.name, agent.session_key!)
                          }}
                          size="xs"
                          variant="ghost"
                          className="h-6 px-2 text-xs text-cyan-300 hover:bg-cyan-500/15 hover:text-cyan-200"
                          title="Wake agent via session"
                        >
                          {t('wake')}
                        </Button>
                      ) : (
                        <Button
                          onClick={(e) => {
                            e.stopPropagation()
                            updateAgentStatus(agent.name, 'idle', 'Manually activated')
                          }}
                          disabled={agent.status === 'idle'}
                          size="xs"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                        >
                          {t('wake')}
                        </Button>
                      )}
                      <Button
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedAgent(agent)
                          setShowQuickSpawnModal(true)
                        }}
                        size="xs"
                        variant="ghost"
                        className="h-6 px-2 text-xs text-blue-300 hover:bg-blue-500/15 hover:text-blue-200"
                      >
                        {t('spawn')}
                      </Button>
                      <Button
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleAgentHidden(agent.id, !agent.hidden)
                        }}
                        size="xs"
                        variant="ghost"
                        className="h-6 px-2 text-xs text-slate-400 hover:bg-slate-500/15 hover:text-slate-300"
                      >
                        {agent.hidden ? 'Unhide' : 'Hide'}
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Agent Detail Modal */}
      {selectedAgent && (
        <AgentDetailModalPhase3
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
          onUpdate={fetchAgents}
          onStatusUpdate={updateAgentStatus}
          onWakeAgent={wakeAgent}
          onDelete={deleteAgent}
        />
      )}

      {/* Create Agent Modal */}
      {showCreateModal && (
        <CreateAgentModal
          onClose={() => setShowCreateModal(false)}
          onCreated={fetchAgents}
        />
      )}

      {/* Mycelium Bridge Agent Message Modal */}
      {selectedBridgeAgent && (
        <BridgeAgentModal
          agent={selectedBridgeAgent}
          onClose={() => setSelectedBridgeAgent(null)}
        />
      )}

      {editingBridgeAgent && (
        <EditBridgeAgentModal
          agent={editingBridgeAgent}
          onClose={() => setEditingBridgeAgent(null)}
          onSaved={() => {
            setEditingBridgeAgent(null)
            fetch('/api/bridge/agents')
              .then(r => r.ok ? r.json() : { agents: [] })
              .then(d => setBridgeAgents(d.agents || []))
              .catch(() => {})
          }}
        />
      )}

      {/* Create Bridge Agent Modal */}
      {showCreateBridgeModal && (
        <CreateBridgeAgentModal
          onClose={() => setShowCreateBridgeModal(false)}
          onCreated={() => {
            setShowCreateBridgeModal(false)
            // Re-fetch bridge agents
            fetch('/api/bridge/agents')
              .then(r => r.ok ? r.json() : { agents: [] })
              .then(d => setBridgeAgents(d.agents || []))
              .catch(() => {})
          }}
        />
      )}

      {/* Quick Spawn Modal */}
      {showQuickSpawnModal && selectedAgent && (
        <QuickSpawnModal
          agent={selectedAgent}
          onClose={() => {
            setShowQuickSpawnModal(false)
            setSelectedAgent(null)
          }}
          onSpawned={fetchAgents}
        />
      )}
    </div>
  )
}

// Enhanced Agent Detail Modal with Tabs
function AgentDetailModalPhase3({
  agent,
  onClose,
  onUpdate,
  onStatusUpdate,
  onWakeAgent,
  onDelete
}: {
  agent: Agent
  onClose: () => void
  onUpdate: () => void
  onStatusUpdate: (name: string, status: Agent['status'], activity?: string) => Promise<void>
  onWakeAgent: (name: string, sessionKey: string) => Promise<void>
  onDelete: (agentId: number, removeWorkspace: boolean) => Promise<void>
}) {
  const [agentState, setAgentState] = useState<Agent & { config?: any; working_memory?: string }>(agent as Agent & { config?: any; working_memory?: string })
  const [activeTab, setActiveTab] = useState<'overview' | 'soul' | 'memory' | 'config' | 'tasks' | 'activity' | 'files' | 'tools' | 'channels' | 'cron' | 'models'>('overview')
  const [editing, setEditing] = useState(false)
  const [formData, setFormData] = useState({
    role: agent.role,
    session_key: agent.session_key || '',
    soul_content: agent.soul_content || '',
    working_memory: agent.working_memory || '',
    model: (() => { const p = (agent as any).config?.model?.primary; return (typeof p === 'string' ? p : p?.primary) || '' })(),
  })
  const [workspaceFiles, setWorkspaceFiles] = useState<{ identityMd: string; agentMd: string }>({
    identityMd: '',
    agentMd: '',
  })
  const [soulTemplates, setSoulTemplates] = useState<SoulTemplate[]>([])
  const [heartbeatData, setHeartbeatData] = useState<HeartbeatResponse | null>(null)
  const [loadingHeartbeat, setLoadingHeartbeat] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [showDeleteMenu, setShowDeleteMenu] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)
  const deleteMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (deleteBusy) return
      if (deleteMenuRef.current && !deleteMenuRef.current.contains(e.target as Node)) {
        setShowDeleteMenu(false)
      }
    }
    if (showDeleteMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showDeleteMenu, deleteBusy])

  useEffect(() => {
    setAgentState(agent as Agent & { config?: any; working_memory?: string })
    setFormData({
      role: agent.role,
      session_key: agent.session_key || '',
      soul_content: agent.soul_content || '',
      working_memory: (agent as any).working_memory || '',
      model: (() => { const p = (agent as any).config?.model?.primary; return (typeof p === 'string' ? p : p?.primary) || '' })(),
    })
  }, [agent])

  useEffect(() => {
    const loadCanonicalAgentData = async () => {
      try {
        const [agentRes, soulRes, memoryRes, filesRes] = await Promise.all([
          fetch(`/api/agents/${agent.id}`),
          fetch(`/api/agents/${agent.id}/soul`),
          fetch(`/api/agents/${agent.id}/memory`),
          fetch(`/api/agents/${agent.id}/files`),
        ])

        if (agentRes.ok) {
          const payload = await agentRes.json()
          if (payload?.agent) {
            const freshAgent = payload.agent as Agent & { config?: any; working_memory?: string }
            setAgentState((prev) => ({ ...prev, ...freshAgent }))
            setFormData((prev) => ({
              ...prev,
              role: freshAgent.role || prev.role,
              session_key: freshAgent.session_key || '',
              model: (freshAgent as any).config?.model?.primary || prev.model,
            }))
          }
        }

        if (soulRes.ok) {
          const payload = await soulRes.json()
          setFormData((prev) => ({ ...prev, soul_content: String(payload?.soul_content || '') }))
        }

        if (memoryRes.ok) {
          const payload = await memoryRes.json()
          setFormData((prev) => ({ ...prev, working_memory: String(payload?.working_memory || '') }))
        }

        if (filesRes.ok) {
          const payload = await filesRes.json()
          setWorkspaceFiles({
            identityMd: String(payload?.files?.['identity.md']?.content || ''),
            agentMd: String(payload?.files?.['agent.md']?.content || ''),
          })
        }
      } catch (error) {
        log.error('Failed to load canonical agent data:', error)
      }
    }

    loadCanonicalAgentData()
  }, [agent.id])

  const formatLastSeen = (timestamp?: number) => {
    if (!timestamp) return 'Never'
    const diffMs = Date.now() - (timestamp * 1000)
    const diffMinutes = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    if (diffMinutes < 1) return 'Just now'
    if (diffMinutes < 60) return `${diffMinutes}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    return new Date(timestamp * 1000).toLocaleDateString()
  }

  // Load SOUL templates
  useEffect(() => {
    const loadTemplates = async () => {
      try {
        const response = await fetch(`/api/agents/${agent.name}/soul`, {
          method: 'PATCH'
        })
        if (response.ok) {
          const data = await response.json()
          setSoulTemplates(data.templates || [])
        }
      } catch (error) {
        log.error('Failed to load SOUL templates:', error)
      }
    }
    
    if (activeTab === 'soul') {
      loadTemplates()
    }
  }, [activeTab, agent.name])

  // Perform heartbeat check
  const performHeartbeat = async () => {
    setLoadingHeartbeat(true)
    try {
      const response = await fetch(`/api/agents/${agent.name}/heartbeat`)
      if (response.ok) {
        const data = await response.json()
        setHeartbeatData(data)
      }
    } catch (error) {
      log.error('Failed to perform heartbeat:', error)
    } finally {
      setLoadingHeartbeat(false)
    }
  }

  const handleSave = async () => {
    setSaveBusy(true)
    try {
      const response = await fetch('/api/agents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: agentState.name,
          ...formData
        })
      })

      if (!response.ok) throw new Error('Failed to update agent')

      setEditing(false)
      onUpdate()
    } catch (error) {
      log.error('Failed to update agent:', error)
    } finally {
      setSaveBusy(false)
    }
  }

  const handleSoulSave = async (content: string, templateName?: string) => {
    try {
      const response = await fetch(`/api/agents/${agentState.id}/soul`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          soul_content: content,
          template_name: templateName
        })
      })

      if (!response.ok) throw new Error('Failed to update SOUL')
      
      setFormData(prev => ({ ...prev, soul_content: content }))
      setAgentState(prev => ({ ...prev, soul_content: content }))
      onUpdate()
    } catch (error) {
      log.error('Failed to update SOUL:', error)
    }
  }

  const handleMemorySave = async (content: string, append: boolean = false) => {
    try {
      const response = await fetch(`/api/agents/${agentState.id}/memory`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          working_memory: content,
          append
        })
      })

      if (!response.ok) throw new Error('Failed to update memory')
      
      const data = await response.json()
      setFormData(prev => ({ ...prev, working_memory: data.working_memory }))
      setAgentState(prev => ({ ...prev, working_memory: data.working_memory }))
      onUpdate()
    } catch (error) {
      log.error('Failed to update memory:', error)
    }
  }

  const handleWorkspaceFileSave = async (file: 'identity.md' | 'agent.md', content: string) => {
    const response = await fetch(`/api/agents/${agentState.id}/files`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file, content }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(payload?.error || `Failed to save ${file}`)
    }
    setWorkspaceFiles((prev) => ({
      ...prev,
      ...(file === 'identity.md' ? { identityMd: content } : { agentMd: content }),
    }))
  }

  const tabs = [
    { id: 'overview', label: 'Overview', icon: 'O' },
    { id: 'files', label: 'Files', icon: 'F' },
    { id: 'tools', label: 'Tools', icon: 'W' },
    { id: 'models', label: 'Models', icon: 'P' },
    { id: 'channels', label: 'Channels', icon: 'H' },
    { id: 'cron', label: 'Cron', icon: 'R' },
    { id: 'soul', label: 'SOUL', icon: 'S' },
    { id: 'memory', label: 'Memory', icon: 'M' },
    { id: 'tasks', label: 'Tasks', icon: 'T' },
    { id: 'config', label: 'Config', icon: 'C' },
    { id: 'activity', label: 'Activity', icon: 'A' }
  ]

  const handleDelete = async (removeWorkspace: boolean) => {
    const scope = removeWorkspace ? 'agent and workspace' : 'agent'
    const confirmed = window.confirm(`Delete ${scope} for "${agentState.name}"? This cannot be undone.`)
    if (!confirmed) return

    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await onDelete(agentState.id, removeWorkspace)
      onClose()
    } catch (error: any) {
      setDeleteError(error?.message || `Failed to delete ${scope}`)
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border/80 rounded-lg shadow-2xl shadow-black/40 max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 pt-5 pb-0 border-b border-border">
          <div className="flex justify-between items-center gap-4 mb-4">
            <div className="flex items-center gap-3 min-w-0">
              <AgentAvatar name={agent.name} size="md" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-foreground leading-tight truncate">{agentState.name}</h3>
                  <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${statusBadgeStyles[agentState.status]}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${statusColors[agentState.status]}`} />
                    {agentState.status}
                  </span>
                  {agentState.session_key && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
                      Session
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-sm text-muted-foreground">{agentState.role}</span>
                  <span className="text-xs text-muted-foreground/60">·</span>
                  <span className="text-xs text-muted-foreground/60">seen {formatLastSeen(agentState.last_seen)}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="relative" ref={deleteMenuRef}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-rose-400"
                  title="Delete agent"
                  onClick={() => setShowDeleteMenu(prev => !prev)}
                >
                  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 0 1 1.34-1.34h2.66a1.33 1.33 0 0 1 1.34 1.34V4M12.67 4v9.33a1.33 1.33 0 0 1-1.34 1.34H4.67a1.33 1.33 0 0 1-1.34-1.34V4" />
                  </svg>
                </Button>
                {showDeleteMenu && (
                  <div className="absolute right-0 top-full mt-1 flex flex-col gap-1 bg-card border border-border rounded-md shadow-xl p-1.5 z-10 min-w-[180px]">
                    <button
                      onClick={() => handleDelete(false)}
                      disabled={deleteBusy}
                      className="text-left text-xs px-2.5 py-1.5 rounded text-rose-300 hover:bg-rose-500/10 transition-colors disabled:opacity-50"
                    >
                      {deleteBusy ? (
                        <span className="flex items-center gap-1.5">
                          <svg className="w-3 h-3 animate-spin" viewBox="0 0 16 16" fill="none">
                            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="8" />
                          </svg>
                          Deleting...
                        </span>
                      ) : 'Delete agent'}
                    </button>
                    <button
                      onClick={() => handleDelete(true)}
                      disabled={deleteBusy}
                      className="text-left text-xs px-2.5 py-1.5 rounded text-rose-400 hover:bg-rose-500/10 transition-colors disabled:opacity-50"
                    >
                      {deleteBusy ? (
                        <span className="flex items-center gap-1.5">
                          <svg className="w-3 h-3 animate-spin" viewBox="0 0 16 16" fill="none">
                            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="8" />
                          </svg>
                          Deleting...
                        </span>
                      ) : 'Delete agent + workspace'}
                    </button>
                  </div>
                )}
              </div>
              <Button
                onClick={onClose}
                aria-label="Close agent details"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-foreground"
              >
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </Button>
            </div>
          </div>

          {deleteError && (
            <div className="mb-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {deleteError}
            </div>
          )}

          {/* Tab Navigation */}
          <div className="flex gap-0 overflow-x-auto -mb-px">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'overview' && (
            <OverviewTab
              agent={agentState}
              editing={editing}
              formData={formData}
              setFormData={setFormData}
              onSave={handleSave}
              saveBusy={saveBusy}
              onStatusUpdate={onStatusUpdate}
              onWakeAgent={onWakeAgent}
              onEdit={() => setEditing(true)}
              onCancel={() => setEditing(false)}
              heartbeatData={heartbeatData}
              loadingHeartbeat={loadingHeartbeat}
              onPerformHeartbeat={performHeartbeat}
            />
          )}
          
          {activeTab === 'soul' && (
            <SoulTab
              agent={agentState}
              soulContent={formData.soul_content}
              templates={soulTemplates}
              onSave={handleSoulSave}
            />
          )}
          
          {activeTab === 'memory' && (
            <MemoryTab
              agent={agentState}
              workingMemory={formData.working_memory}
              onSave={handleMemorySave}
            />
          )}
          
          {activeTab === 'tasks' && (
            <TasksTab agent={agentState} />
          )}
          
          {activeTab === 'config' && (
            <ConfigTab
              agent={agentState}
              workspaceFiles={workspaceFiles}
              onSaveWorkspaceFile={handleWorkspaceFileSave}
              onSave={onUpdate}
            />
          )}

          {activeTab === 'files' && (
            <FilesTab agent={agentState} />
          )}

          {activeTab === 'tools' && (
            <ToolsTab agent={agentState} />
          )}

          {activeTab === 'channels' && (
            <ChannelsTab agent={agentState} />
          )}

          {activeTab === 'cron' && (
            <CronTab agent={agentState} />
          )}

          {activeTab === 'models' && (
            <ModelsTab agent={agentState} />
          )}

          {activeTab === 'activity' && (
            <ActivityTab agent={agentState} />
          )}
        </div>
      </div>
    </div>
  )
}

// Quick Spawn Modal Component
function QuickSpawnModal({
  agent,
  onClose,
  onSpawned
}: {
  agent: Agent
  onClose: () => void
  onSpawned: () => void
}) {
  const [spawnData, setSpawnData] = useState({
    task: '',
    model: 'sonnet',
    label: `${agent.name}-subtask-${Date.now()}`,
    timeoutSeconds: 300
  })
  const [isSpawning, setIsSpawning] = useState(false)
  const [spawnResult, setSpawnResult] = useState<any>(null)

  const models = [
    { id: 'haiku', name: 'Claude Haiku', cost: '$0.25/1K', speed: 'Ultra Fast' },
    { id: 'sonnet', name: 'Claude Sonnet', cost: '$3.00/1K', speed: 'Fast' },
    { id: 'opus', name: 'Claude Opus', cost: '$15.00/1K', speed: 'Slow' },
    { id: 'groq-fast', name: 'Groq Llama 8B', cost: '$0.05/1K', speed: '840 tok/s' },
    { id: 'groq', name: 'Groq Llama 70B', cost: '$0.59/1K', speed: '150 tok/s' },
    { id: 'deepseek', name: 'DeepSeek R1', cost: 'FREE', speed: 'Local' },
  ]

  const handleSpawn = async () => {
    if (!spawnData.task.trim()) {
      alert('Please enter a task description')
      return
    }

    setIsSpawning(true)
    try {
      const response = await fetch('/api/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...spawnData,
          parentAgent: agent.name,
          sessionKey: agent.session_key
        })
      })

      const result = await response.json()
      if (response.ok) {
        setSpawnResult(result)
        onSpawned()
        
        // Auto-close after 2 seconds if successful
        setTimeout(() => {
          onClose()
        }, 2000)
      } else {
        alert(result.error || 'Failed to spawn agent')
      }
    } catch (error) {
      log.error('Spawn failed:', error)
      alert('Network error occurred')
    } finally {
      setIsSpawning(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-lg max-w-md w-full p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold text-foreground">
            Quick Spawn for {agent.name}
          </h3>
          <Button onClick={onClose} variant="ghost" size="icon-sm" className="text-2xl">×</Button>
        </div>

        {spawnResult ? (
          <div className="space-y-4">
            <div className="bg-green-500/10 border border-green-500/20 text-green-400 p-3 rounded-lg text-sm">
              Agent spawned successfully!
            </div>
            <div className="text-sm text-foreground/80">
              <p><strong>Agent ID:</strong> {spawnResult.agentId}</p>
              <p><strong>Session:</strong> {spawnResult.sessionId}</p>
              <p><strong>Model:</strong> {spawnResult.model}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Task Description */}
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-2">
                Task Description *
              </label>
              <textarea
                value={spawnData.task}
                onChange={(e) => setSpawnData(prev => ({ ...prev, task: e.target.value }))}
                placeholder={`Delegate a subtask to ${agent.name}...`}
                className="w-full h-24 px-3 py-2 bg-surface-1 border border-border rounded text-foreground placeholder-muted-foreground focus:border-primary/50 focus:ring-1 focus:ring-primary/50 resize-none"
              />
            </div>

            {/* Model Selection */}
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-2">
                Model
              </label>
              <select
                value={spawnData.model}
                onChange={(e) => setSpawnData(prev => ({ ...prev, model: e.target.value }))}
                className="w-full px-3 py-2 bg-surface-1 border border-border rounded text-foreground focus:border-primary/50 focus:ring-1 focus:ring-primary/50"
              >
                {models.map(model => (
                  <option key={model.id} value={model.id}>
                    {model.name} - {model.cost} ({model.speed})
                  </option>
                ))}
              </select>
            </div>

            {/* Agent Label */}
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-2">
                Agent Label
              </label>
              <input
                type="text"
                value={spawnData.label}
                onChange={(e) => setSpawnData(prev => ({ ...prev, label: e.target.value }))}
                className="w-full px-3 py-2 bg-surface-1 border border-border rounded text-foreground focus:border-primary/50 focus:ring-1 focus:ring-primary/50"
              />
            </div>

            {/* Timeout */}
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-2">
                Timeout (seconds)
              </label>
              <input
                type="number"
                value={spawnData.timeoutSeconds}
                onChange={(e) => setSpawnData(prev => ({ ...prev, timeoutSeconds: parseInt(e.target.value) }))}
                min={30}
                max={3600}
                className="w-full px-3 py-2 bg-surface-1 border border-border rounded text-foreground focus:border-primary/50 focus:ring-1 focus:ring-primary/50"
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              <Button
                onClick={handleSpawn}
                disabled={isSpawning || !spawnData.task.trim()}
                className="flex-1"
              >
                {isSpawning ? 'Spawning...' : 'Spawn Agent'}
              </Button>
              <Button
                onClick={onClose}
                variant="secondary"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default AgentSquadPanelPhase3

// ── Mycelium Bridge integration ───────────────────────────────────────────────

interface BridgeAgentView {
  id: string
  name: string
  provider: string
  model: string
  system_prompt?: string
  status: string
  profile_status: string
}

const BRIDGE_DEFAULT_MODEL = 'deepseek/deepseek-v4-flash:free'

// OpenRouter models — verified 2026-05-24 against /api/v1/models (358 total)
// ⚠ = no function-call support; will fail for agents that have tools enabled
const OPENROUTER_MODELS = [
  // ── Free · tool-capable ───────────────────────────────────────────────────
  { value: 'deepseek/deepseek-v4-flash:free',                label: '[free] DeepSeek V4 Flash' },
  { value: 'openai/gpt-oss-20b:free',                        label: '[free] OpenAI GPT-OSS 20B' },
  { value: 'openai/gpt-oss-120b:free',                       label: '[free] OpenAI GPT-OSS 120B' },
  { value: 'google/gemma-4-31b-it:free',                     label: '[free] Google Gemma 4 31B' },
  { value: 'google/gemma-4-26b-a4b-it:free',                 label: '[free] Google Gemma 4 26B A4B' },
  { value: 'meta-llama/llama-3.3-70b-instruct:free',         label: '[free] Llama 3.3 70B' },
  { value: 'nvidia/nemotron-nano-9b-v2:free',                label: '[free] NVIDIA Nemotron Nano 9B' },
  { value: 'nvidia/nemotron-3-nano-30b-a3b:free',            label: '[free] NVIDIA Nemotron 3 Nano 30B' },
  { value: 'nvidia/nemotron-3-super-120b-a12b:free',         label: '[free] NVIDIA Nemotron 120B (slow)' },
  { value: 'qwen/qwen3-next-80b-a3b-instruct:free',          label: '[free] Qwen3 Next 80B' },
  { value: 'qwen/qwen3-coder:free',                          label: '[free] Qwen3 Coder 480B' },
  { value: 'minimax/minimax-m2.5:free',                      label: '[free] MiniMax M2.5' },
  { value: 'poolside/laguna-xs.2:free',                      label: '[free] Poolside Laguna XS.2' },
  { value: 'poolside/laguna-m.1:free',                       label: '[free] Poolside Laguna M.1' },
  { value: 'arcee-ai/trinity-large-thinking:free',           label: '[free] Arcee Trinity Large Thinking' },
  { value: 'z-ai/glm-4.5-air:free',                         label: '[free] GLM 4.5 Air' },
  // ── Free · no tool support ────────────────────────────────────────────────
  { value: 'meta-llama/llama-3.2-3b-instruct:free',          label: '[free ⚠no-tools] Llama 3.2 3B' },
  { value: 'nousresearch/hermes-3-llama-3.1-405b:free',      label: '[free ⚠no-tools] Hermes 3 405B' },
  { value: 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free', label: '[free ⚠no-tools] Dolphin Mistral 24B' },
  // ── Anthropic ─────────────────────────────────────────────────────────────
  { value: 'anthropic/claude-3-haiku',                       label: 'Claude 3 Haiku ($0.25/M)' },
  { value: 'anthropic/claude-3.5-haiku',                     label: 'Claude 3.5 Haiku ($0.80/M)' },
  { value: 'anthropic/claude-haiku-4.5',                     label: 'Claude Haiku 4.5 ($1/M)' },
  { value: 'anthropic/claude-sonnet-4.5',                    label: 'Claude Sonnet 4.5 ($3/M)' },
  { value: 'anthropic/claude-sonnet-4.6',                    label: 'Claude Sonnet 4.6 ($3/M)' },
  { value: 'anthropic/claude-opus-4.5',                      label: 'Claude Opus 4.5 ($5/M)' },
  // ── OpenAI ────────────────────────────────────────────────────────────────
  { value: 'openai/gpt-4o-mini',                             label: 'GPT-4o Mini ($0.15/M)' },
  { value: 'openai/gpt-4.1-mini',                            label: 'GPT-4.1 Mini ($0.40/M)' },
  { value: 'openai/gpt-4o',                                  label: 'GPT-4o ($2.50/M)' },
  { value: 'openai/gpt-4.1',                                 label: 'GPT-4.1 ($2/M)' },
  { value: 'openai/o4-mini',                                 label: 'o4 Mini ($1.10/M)' },
  // ── Google ────────────────────────────────────────────────────────────────
  { value: 'google/gemini-2.0-flash-001',                    label: 'Gemini 2.0 Flash ($0.10/M)' },
  { value: 'google/gemini-2.5-flash',                        label: 'Gemini 2.5 Flash ($0.30/M)' },
  { value: 'google/gemini-2.5-pro',                          label: 'Gemini 2.5 Pro ($1.25/M)' },
  // ── DeepSeek ──────────────────────────────────────────────────────────────
  { value: 'deepseek/deepseek-v4-flash',                     label: 'DeepSeek V4 Flash ($0.10/M)' },
  { value: 'deepseek/deepseek-chat-v3-0324',                 label: 'DeepSeek V3 ($0.20/M)' },
  { value: 'deepseek/deepseek-r1',                           label: 'DeepSeek R1 ($0.70/M)' },
  // ── Mistral ───────────────────────────────────────────────────────────────
  { value: 'mistralai/mistral-nemo',                         label: 'Mistral Nemo ($0.02/M)' },
  { value: 'mistralai/mistral-small-3.2-24b-instruct',       label: 'Mistral Small 3.2 24B ($0.07/M)' },
  { value: 'mistralai/mistral-large-2512',                   label: 'Mistral Large ($0.50/M)' },
  // ── Meta ──────────────────────────────────────────────────────────────────
  { value: 'meta-llama/llama-3.1-8b-instruct',               label: 'Llama 3.1 8B ($0.02/M)' },
  { value: 'meta-llama/llama-3.3-70b-instruct',              label: 'Llama 3.3 70B ($0.10/M)' },
  { value: 'meta-llama/llama-4-scout',                       label: 'Llama 4 Scout ($0.08/M)' },
  // ── Qwen ──────────────────────────────────────────────────────────────────
  { value: 'qwen/qwen3-8b',                                  label: 'Qwen3 8B ($0.05/M)' },
  { value: 'qwen/qwen3-32b',                                 label: 'Qwen3 32B ($0.08/M)' },
  { value: 'qwen/qwen3-235b-a22b',                           label: 'Qwen3 235B A22B ($0.45/M)' },
  // ── xAI ───────────────────────────────────────────────────────────────────
  { value: 'x-ai/grok-4.3',                                  label: 'Grok 4.3 ($1.25/M)' },
]

// Anthropic direct models
const CLAUDE_MODELS = [
  { value: 'claude-haiku-4-5-20251001',   label: 'Claude Haiku 4.5' },
  { value: 'claude-sonnet-4-5-20251022',  label: 'Claude Sonnet 4.5' },
  { value: 'claude-opus-4-5-20251101',    label: 'Claude Opus 4.5' },
]

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// ── BridgeModelSelect ─────────────────────────────────────────────────────────

const AVAILABLE_TOOLS_LIST = [
  { id: 'agent_message',    desc: 'Send messages to other agents and receive their response' },
  { id: 'context_preview',  desc: 'Preview how context will be assembled for a session' },
  { id: 'session_lookup',   desc: 'Read messages and tasks from existing sessions' },
  { id: 'knowledge_search', desc: 'Search the shared knowledge base' },
  { id: 'current_time',     desc: 'Get the current UTC time' },
]

function BridgeModelSelect({
  provider,
  value,
  onChange,
}: {
  provider: string
  value: string
  onChange: (model: string) => void
}) {
  const models = provider === 'claude' ? CLAUDE_MODELS : OPENROUTER_MODELS
  const isKnown = models.some(m => m.value === value)
  const [custom, setCustom] = useState(!isKnown && value !== '')

  const handleSelectChange = (v: string) => {
    if (v === '__custom__') {
      setCustom(true)
      onChange('')
    } else {
      setCustom(false)
      onChange(v)
    }
  }

  return (
    <div>
      <label className="block text-sm text-muted-foreground mb-1">Model</label>
      {!custom ? (
        <select
          value={value || ''}
          onChange={e => handleSelectChange(e.target.value)}
          required
          className="w-full px-3 py-2 bg-surface-1 border border-border rounded text-foreground font-mono text-sm focus:border-violet-500/50"
        >
          <option value="">— select a model —</option>
          {models.map(m => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
          <option value="__custom__">Custom model ID…</option>
        </select>
      ) : (
        <div className="flex gap-2">
          <input
            value={value}
            onChange={e => onChange(e.target.value)}
            required
            placeholder="provider/model-name"
            className="flex-1 px-3 py-2 bg-surface-1 border border-border rounded text-foreground font-mono text-sm focus:border-violet-500/50"
          />
          <button
            type="button"
            onClick={() => { setCustom(false); onChange('') }}
            className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded"
          >
            List
          </button>
        </div>
      )}
    </div>
  )
}

// ── ToolCheckboxes ─────────────────────────────────────────────────────────────

function ToolCheckboxes({
  selected,
  onChange,
}: {
  selected: string[]
  onChange: (tools: string[]) => void
}) {
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter(t => t !== id) : [...selected, id])

  return (
    <div>
      <label className="block text-sm text-muted-foreground mb-2">Tools (optional)</label>
      <div className="space-y-1.5">
        {AVAILABLE_TOOLS_LIST.map(tool => (
          <label key={tool.id} className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.includes(tool.id)}
              onChange={() => toggle(tool.id)}
              className="mt-0.5 accent-violet-500"
            />
            <span className="text-sm leading-tight">
              <span className="text-foreground font-mono">{tool.id}</span>
              <span className="text-muted-foreground/60 text-xs ml-1.5">— {tool.desc}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}

// ── EditBridgeAgentModal ──────────────────────────────────────────────────────

function EditBridgeAgentModal({
  agent,
  onClose,
  onSaved,
}: {
  agent: BridgeAgentView
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    name: agent.name,
    provider: agent.provider,
    model: agent.model,
    system_prompt: agent.system_prompt || '',
    tools: (agent as any).tools as string[] || [],
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/bridge/agents/${agent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name || undefined,
          provider: form.provider || undefined,
          model: form.model || undefined,
          system_prompt: form.system_prompt || undefined,
          tools: form.tools,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to update agent')
      }
      onSaved()
    } catch (e: any) {
      setErr(e.message || 'Error')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/bridge/agents/${agent.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to delete agent')
      }
      onSaved()
    } catch (e: any) {
      setErr(e.message || 'Error')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-violet-500/30 rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-lg font-bold text-foreground">Edit Agent</h3>
              <p className="text-xs text-muted-foreground font-mono mt-0.5">id: {agent.id}</p>
            </div>
            <Button onClick={onClose} type="button" variant="ghost" size="icon-sm" className="text-xl">×</Button>
          </div>

          {err && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded px-3 py-2">
              {err}
            </div>
          )}

          <div>
            <label className="block text-sm text-muted-foreground mb-1">Name</label>
            <input
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              className="w-full px-3 py-2 bg-surface-1 border border-border rounded text-foreground focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50"
            />
          </div>

          <div>
            <label className="block text-sm text-muted-foreground mb-1">Provider</label>
            <select
              value={form.provider}
              onChange={e => setForm(p => ({ ...p, provider: e.target.value, model: '' }))}
              className="w-full px-3 py-2 bg-surface-1 border border-border rounded text-foreground focus:border-violet-500/50"
            >
              <option value="openrouter">OpenRouter</option>
              <option value="claude">Claude (Anthropic)</option>
            </select>
          </div>

          <BridgeModelSelect
            provider={form.provider}
            value={form.model}
            onChange={model => setForm(p => ({ ...p, model }))}
          />

          <div>
            <label className="block text-sm text-muted-foreground mb-1">System Prompt</label>
            <textarea
              value={form.system_prompt}
              onChange={e => setForm(p => ({ ...p, system_prompt: e.target.value }))}
              rows={4}
              placeholder="You are a helpful assistant."
              className="w-full px-3 py-2 bg-surface-1 border border-border rounded text-foreground focus:border-violet-500/50"
            />
          </div>

          <ToolCheckboxes selected={form.tools} onChange={tools => setForm(p => ({ ...p, tools }))} />

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={busy} className="flex-1 bg-violet-600 hover:bg-violet-700 text-white">
              {busy ? 'Saving...' : 'Save'}
            </Button>
            <Button type="button" onClick={onClose} variant="secondary">Cancel</Button>
          </div>

          <div className="border-t border-border/30 pt-3">
            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="text-xs text-red-400/70 hover:text-red-400 transition-colors"
              >
                Delete agent…
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-400">Delete {agent.name}?</span>
                <button type="button" onClick={handleDelete} disabled={busy} className="text-xs text-red-400 font-semibold hover:text-red-300">Yes, delete</button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}

// ── CreateBridgeAgentModal ────────────────────────────────────────────────────

function CreateBridgeAgentModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [form, setForm] = useState({
    name: '',
    bridge_id: '',
    provider: 'openrouter',
    model: BRIDGE_DEFAULT_MODEL,
    system_prompt: '',
    tools: [] as string[],
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handleNameChange = (name: string) => {
    setForm(prev => ({
      ...prev,
      name,
      bridge_id:
        prev.bridge_id === slugify(prev.name) || prev.bridge_id === ''
          ? slugify(name)
          : prev.bridge_id,
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const id = form.bridge_id || slugify(form.name)
      const res = await fetch('/api/bridge/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          name: form.name,
          provider: form.provider,
          model: form.model,
          system_prompt: form.system_prompt || undefined,
          tools: form.tools.length > 0 ? form.tools : undefined,
          channels: ['dashboard'],
          status: 'online',
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to create agent')
      }
      onCreated()
    } catch (e: any) {
      setErr(e.message || 'Error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-violet-500/30 rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-bold text-foreground">New Mycelium Agent</h3>
            <Button onClick={onClose} type="button" variant="ghost" size="icon-sm" className="text-xl">×</Button>
          </div>

          {err && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded px-3 py-2">
              {err}
            </div>
          )}

          <div>
            <label className="block text-sm text-muted-foreground mb-1">Name</label>
            <input
              value={form.name}
              onChange={e => handleNameChange(e.target.value)}
              required
              className="w-full px-3 py-2 bg-surface-1 border border-border rounded text-foreground focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50"
            />
          </div>

          <div>
            <label className="block text-sm text-muted-foreground mb-1">Agent ID</label>
            <input
              value={form.bridge_id}
              onChange={e => setForm(p => ({ ...p, bridge_id: e.target.value }))}
              placeholder="auto-generated from name"
              className="w-full px-3 py-2 bg-surface-1 border border-border rounded text-foreground font-mono text-sm focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50"
            />
            <p className="text-xs text-muted-foreground/60 mt-1">Unique slug (lowercase, hyphens)</p>
          </div>

          <div>
            <label className="block text-sm text-muted-foreground mb-1">Provider</label>
            <select
              value={form.provider}
              onChange={e => setForm(p => ({ ...p, provider: e.target.value, model: '' }))}
              className="w-full px-3 py-2 bg-surface-1 border border-border rounded text-foreground focus:border-violet-500/50"
            >
              <option value="openrouter">OpenRouter</option>
              <option value="claude">Claude (Anthropic)</option>
            </select>
          </div>

          <BridgeModelSelect
            provider={form.provider}
            value={form.model}
            onChange={model => setForm(p => ({ ...p, model }))}
          />

          <div>
            <label className="block text-sm text-muted-foreground mb-1">System Prompt (optional)</label>
            <textarea
              value={form.system_prompt}
              onChange={e => setForm(p => ({ ...p, system_prompt: e.target.value }))}
              rows={3}
              placeholder="You are a helpful assistant."
              className="w-full px-3 py-2 bg-surface-1 border border-border rounded text-foreground focus:border-violet-500/50"
            />
          </div>

          <ToolCheckboxes selected={form.tools} onChange={tools => setForm(p => ({ ...p, tools }))} />

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={busy} className="flex-1 bg-violet-600 hover:bg-violet-700 text-white">
              {busy ? 'Creating...' : 'Create Agent'}
            </Button>
            <Button type="button" onClick={onClose} variant="secondary">Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── BridgeAgentModal (chat) ───────────────────────────────────────────────────

interface ChatEntry {
  role: 'user' | 'assistant' | 'status'
  text: string
}

function BridgeAgentModal({
  agent,
  onClose,
}: {
  agent: BridgeAgentView
  onClose: () => void
}) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [history, setHistory] = useState<ChatEntry[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [elapsedSecs, setElapsedSecs] = useState(0)
  const bottomRef = useRef<HTMLDivElement>(null)
  const elapsedRef = useRef<NodeJS.Timeout | undefined>(undefined)

  useEffect(() => {
    if (sending) {
      setElapsedSecs(0)
      elapsedRef.current = setInterval(() => setElapsedSecs(s => s + 1), 1000)
    } else {
      clearInterval(elapsedRef.current)
    }
    return () => clearInterval(elapsedRef.current)
  }, [sending])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history, sending])

  const handleSend = async () => {
    const msg = input.trim()
    if (!msg || sending) return
    setInput('')
    setSendError(null)
    setHistory(h => [...h, { role: 'user', text: msg }])
    setSending(true)

    try {
      const res = await fetch('/api/bridge/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: agent.id,
          session_id: sessionId || undefined,
          message: msg,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send')
      setSessionId(data.session_id)
      setHistory(h => [
        ...h,
        data.status === 'failed'
          ? { role: 'status' as const, text: `Error: ${data.error || 'Provider error'}` }
          : { role: 'assistant' as const, text: data.response_text || '(empty response)' },
      ])
    } catch (e: any) {
      setSendError(e.message || 'Error sending message')
      setHistory(h => h.slice(0, -1))
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
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div
        className="bg-card border border-violet-500/30 rounded-xl w-full max-w-2xl flex flex-col"
        style={{ height: '70vh' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-violet-500/20 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-foreground">{agent.name}</h3>
              <span className="text-2xs px-1.5 py-0.5 rounded-full border bg-violet-500/15 text-violet-300 border-violet-500/30">
                mycelium
              </span>
            </div>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">
              {agent.provider} / {agent.model}
            </p>
          </div>
          <Button onClick={onClose} variant="ghost" size="icon-sm" className="text-xl">×</Button>
        </div>

        {/* Chat history */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {history.length === 0 && (
            <p className="text-muted-foreground/50 text-sm text-center pt-8">
              Send a message to start a conversation with this agent.
            </p>
          )}
          {history.map((entry, i) => (
            <div key={i} className={`flex ${entry.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                  entry.role === 'user'
                    ? 'bg-violet-600/80 text-white'
                    : entry.role === 'status'
                      ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                      : 'bg-surface-2 text-foreground border border-border/50'
                }`}
              >
                {entry.text}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-surface-2 border border-border/50 rounded-xl px-3 py-2 text-sm text-muted-foreground animate-pulse">
                Thinking... {elapsedSecs > 0 && <span className="text-xs opacity-60">({elapsedSecs}s)</span>}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Error banner */}
        {sendError && (
          <div className="mx-4 mb-2 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded px-3 py-2 shrink-0 flex items-center justify-between">
            <span>{sendError}</span>
            <Button onClick={() => setSendError(null)} variant="ghost" size="icon-sm" className="text-red-400/60">×</Button>
          </div>
        )}

        {/* Input */}
        <div className="p-4 border-t border-violet-500/20 shrink-0">
          <div className="flex gap-2 items-end">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
              rows={2}
              placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
              className="flex-1 px-3 py-2 bg-surface-1 border border-border rounded text-sm text-foreground resize-none focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50 disabled:opacity-50"
            />
            <Button
              onClick={handleSend}
              disabled={sending || !input.trim()}
              className="shrink-0 bg-violet-600 hover:bg-violet-700 text-white"
            >
              {sending ? '...' : 'Send'}
            </Button>
          </div>
          {sessionId && (
            <p className="text-[10px] text-muted-foreground/40 mt-1 font-mono truncate" title={sessionId}>
              session: {sessionId}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
