'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import type { BridgeKnowledgeDoc, BridgeKnowledgeSearchResult, MyceliumAgent } from '@/lib/mycelium-bridge'

// ── Types ─────────────────────────────────────────────────────────────────────

type PanelView = 'editor' | 'graph'
type DocGroup = { scope: string; label: string; docs: BridgeKnowledgeDoc[] }

interface EditorState {
  id?: string
  title: string
  slug: string
  scope: string
  content: string
}

function makeSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() / 1000) - ts)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function BridgeKnowledgePanel() {
  const [docs, setDocs] = useState<BridgeKnowledgeDoc[]>([])
  const [agents, setAgents] = useState<MyceliumAgent[]>([])
  const [selected, setSelected] = useState<EditorState | null>(null)
  const [view, setView] = useState<PanelView>('editor')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<BridgeKnowledgeSearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [graphData, setGraphData] = useState<{ nodes: any[]; edges: any[] } | null>(null)
  const [graphLoading, setGraphLoading] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  // ── Data loading ───────────────────────────────────────────────────────────

  const loadDocs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Fetch shared docs
      const sharedRes = await fetch('/api/bridge/knowledge?scope=shared&limit=100')
      const sharedData = await sharedRes.json()
      const sharedDocs: BridgeKnowledgeDoc[] = sharedData.docs ?? []

      // Fetch agents and their knowledge docs
      const agentsRes = await fetch('/api/bridge/agents')
      const agentsData = await agentsRes.json()
      const bridgeAgents: MyceliumAgent[] = (agentsData.agents ?? []).filter(
        (a: MyceliumAgent) => a.framework === 'mycelium' || true
      )
      setAgents(bridgeAgents)

      const agentDocPromises = bridgeAgents.map(async (agent) => {
        try {
          const res = await fetch(`/api/bridge/knowledge?scope=agent:${agent.id}&limit=100`)
          const data = await res.json()
          return (data.docs ?? []) as BridgeKnowledgeDoc[]
        } catch {
          return []
        }
      })
      const agentDocResults = await Promise.all(agentDocPromises)
      const allAgentDocs = agentDocResults.flat()

      setDocs([...sharedDocs, ...allAgentDocs])
    } catch (err: any) {
      setError(err.message ?? 'Failed to load knowledge docs')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadDocs() }, [loadDocs])

  const loadGraph = useCallback(async () => {
    setGraphLoading(true)
    try {
      const res = await fetch('/api/bridge/knowledge/graph')
      const data = await res.json()
      setGraphData(data)
    } catch {
      setGraphData({ nodes: [], edges: [] })
    } finally {
      setGraphLoading(false)
    }
  }, [])

  useEffect(() => {
    if (view === 'graph' && !graphData) loadGraph()
  }, [view, graphData, loadGraph])

  // ── Grouped sidebar list ───────────────────────────────────────────────────

  const groups = useMemo<DocGroup[]>(() => {
    const byScope: Record<string, BridgeKnowledgeDoc[]> = {}
    for (const doc of docs) {
      if (!byScope[doc.scope]) byScope[doc.scope] = []
      byScope[doc.scope].push(doc)
    }
    const result: DocGroup[] = []
    if (byScope['shared']) {
      result.push({ scope: 'shared', label: 'Shared', docs: byScope['shared'] })
    }
    for (const [scope, scopeDocs] of Object.entries(byScope)) {
      if (scope === 'shared') continue
      const agentId = scope.replace(/^agent:/, '')
      const agent = agents.find(a => a.id === agentId)
      result.push({ scope, label: agent ? agent.name : agentId, docs: scopeDocs })
    }
    return result
  }, [docs, agents])

  // ── Search ─────────────────────────────────────────────────────────────────

  const handleSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setSearchResults(null); return }
    setSearching(true)
    try {
      const scopes = ['shared', ...agents.map(a => `agent:${a.id}`)].join(',')
      const res = await fetch(`/api/bridge/knowledge/search?q=${encodeURIComponent(q)}&scopes=${encodeURIComponent(scopes)}&limit=20`)
      const data = await res.json()
      setSearchResults(data.results ?? [])
    } catch {
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }, [agents])

  useEffect(() => {
    const t = setTimeout(() => handleSearch(searchQuery), 300)
    return () => clearTimeout(t)
  }, [searchQuery, handleSearch])

  // ── Editor actions ─────────────────────────────────────────────────────────

  const openNew = () => {
    setSelected({ title: '', slug: '', scope: 'shared', content: '' })
    setSearchQuery('')
    setSearchResults(null)
    setConfirmDelete(false)
    setIsDirty(false)
    setView('editor')
  }

  const openDoc = async (doc: BridgeKnowledgeDoc) => {
    setSearchQuery('')
    setSearchResults(null)
    setConfirmDelete(false)
    setIsDirty(false)
    setView('editor')
    // Fetch full content
    try {
      const res = await fetch(`/api/bridge/knowledge/${doc.id}`)
      const data = await res.json()
      const full = data.doc ?? doc
      setSelected({ id: full.id, title: full.title, slug: full.slug, scope: full.scope, content: full.content })
    } catch {
      setSelected({ id: doc.id, title: doc.title, slug: doc.slug, scope: doc.scope, content: doc.content ?? '' })
    }
  }

  const handleSave = async () => {
    if (!selected) return
    if (!selected.title.trim()) { setError('Title is required'); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/bridge/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selected.id,
          title: selected.title,
          slug: selected.slug || makeSlug(selected.title),
          scope: selected.scope,
          content: selected.content,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Save failed')
      const saved: BridgeKnowledgeDoc = data.doc
      setSelected({ id: saved.id, title: saved.title, slug: saved.slug, scope: saved.scope, content: saved.content })
      setIsDirty(false)
      // Update local docs list
      setDocs(prev => {
        const idx = prev.findIndex(d => d.id === saved.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = saved
          return next
        }
        return [...prev, saved]
      })
    } catch (err: any) {
      setError(err.message ?? 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selected?.id) return
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch(`/api/bridge/knowledge?id=${selected.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Delete failed')
      }
      setDocs(prev => prev.filter(d => d.id !== selected.id))
      setSelected(null)
      setConfirmDelete(false)
    } catch (err: any) {
      setError(err.message ?? 'Failed to delete')
    } finally {
      setDeleting(false)
    }
  }

  const openSearchResult = (r: BridgeKnowledgeSearchResult) => {
    const doc = docs.find(d => d.id === r.id)
    if (doc) { openDoc(doc); return }
    // Not in list yet — open by fetching
    openDoc({ id: r.id, title: r.title, slug: r.slug, scope: r.scope, content: '', created_at: 0, updated_at: 0 })
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Sidebar ────────────────────────────────────────────────────────── */}
      <div className="w-64 flex-shrink-0 border-r border-border flex flex-col">
        {/* Header */}
        <div className="p-3 border-b border-border flex items-center gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search knowledge…"
            className="flex-1 min-w-0 bg-secondary border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <Button size="sm" onClick={openNew} className="flex-shrink-0 h-6 px-2 text-xs">
            +
          </Button>
        </div>

        {/* View toggle */}
        <div className="flex border-b border-border text-xs">
          {(['editor', 'graph'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`flex-1 py-1.5 capitalize transition-colors ${
                view === v ? 'text-foreground border-b-2 border-violet-500' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {v === 'editor' ? 'Docs' : 'Graph'}
            </button>
          ))}
        </div>

        {/* Doc list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-xs text-muted-foreground text-center">Loading…</div>
          ) : searchResults !== null ? (
            <SearchResultsList results={searchResults} searching={searching} onSelect={openSearchResult} />
          ) : groups.length === 0 ? (
            <div className="p-4 text-xs text-muted-foreground text-center">
              No knowledge docs yet.<br />Click + to create one.
            </div>
          ) : (
            groups.map(g => (
              <DocGroupSection
                key={g.scope}
                group={g}
                selectedId={selected?.id}
                onSelect={openDoc}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-2 border-t border-border">
          <Button size="sm" variant="outline" onClick={loadDocs} disabled={loading} className="w-full text-xs h-6">
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Main area ──────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {error && (
          <div className="mx-4 mt-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-2 text-muted-foreground hover:text-foreground">×</button>
          </div>
        )}

        {view === 'graph' ? (
          <GraphView data={graphData} loading={graphLoading} onRefresh={loadGraph} onSelect={openDoc} docs={docs} />
        ) : selected ? (
          <DocEditor
            state={selected}
            agents={agents}
            saving={saving}
            deleting={deleting}
            confirmDelete={confirmDelete}
            isDirty={isDirty}
            onChange={(field, val) => {
              setSelected(prev => prev ? { ...prev, [field]: val } : prev)
              if (field === 'title' && !selected.id) {
                setSelected(prev => prev ? { ...prev, slug: makeSlug(val as string) } : prev)
              }
              setIsDirty(true)
            }}
            onSave={handleSave}
            onDeleteRequest={() => setConfirmDelete(true)}
            onDeleteConfirm={handleDelete}
            onDeleteCancel={() => setConfirmDelete(false)}
            onDiscard={() => { setSelected(null); setIsDirty(false) }}
          />
        ) : (
          <EmptyState onNew={openNew} />
        )}
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DocGroupSection({
  group, selectedId, onSelect,
}: {
  group: DocGroup
  selectedId?: string
  onSelect: (doc: BridgeKnowledgeDoc) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div>
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        <span>{collapsed ? '▶' : '▼'}</span>
        <span>{group.label}</span>
        <span className="ml-auto text-[9px] opacity-60">{group.docs.length}</span>
      </button>
      {!collapsed && group.docs.map(doc => (
        <button
          key={doc.id}
          onClick={() => onSelect(doc)}
          className={`w-full text-left px-4 py-1.5 text-xs transition-colors truncate ${
            doc.id === selectedId
              ? 'bg-violet-500/15 text-violet-300'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
          }`}
          title={doc.title}
        >
          <span className="block truncate">{doc.title}</span>
          <span className="block text-[10px] opacity-50">{timeAgo(doc.updated_at)}</span>
        </button>
      ))}
    </div>
  )
}

function SearchResultsList({
  results, searching, onSelect,
}: {
  results: BridgeKnowledgeSearchResult[]
  searching: boolean
  onSelect: (r: BridgeKnowledgeSearchResult) => void
}) {
  if (searching) return <div className="p-4 text-xs text-muted-foreground text-center">Searching…</div>
  if (results.length === 0) return <div className="p-4 text-xs text-muted-foreground text-center">No results</div>
  return (
    <div>
      {results.map(r => (
        <button
          key={r.id}
          onClick={() => onSelect(r)}
          className="w-full text-left px-3 py-2 hover:bg-secondary transition-colors border-b border-border/50"
        >
          <div className="text-xs font-medium text-foreground truncate">{r.title}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2"
            dangerouslySetInnerHTML={{ __html: r.snippet.replace(/\*\*(.*?)\*\*/g, '<mark class="bg-yellow-500/30 text-yellow-200 rounded px-0.5">$1</mark>') }}
          />
          <div className="text-[9px] text-violet-400/70 mt-0.5">{r.scope}</div>
        </button>
      ))}
    </div>
  )
}

function DocEditor({
  state, agents, saving, deleting, confirmDelete, isDirty,
  onChange, onSave, onDeleteRequest, onDeleteConfirm, onDeleteCancel, onDiscard,
}: {
  state: EditorState
  agents: MyceliumAgent[]
  saving: boolean
  deleting: boolean
  confirmDelete: boolean
  isDirty: boolean
  onChange: (field: keyof EditorState, value: string) => void
  onSave: () => void
  onDeleteRequest: () => void
  onDeleteConfirm: () => void
  onDeleteCancel: () => void
  onDiscard: () => void
}) {
  const scopeOptions = [
    { value: 'shared', label: 'Shared (all agents)' },
    ...agents.map(a => ({ value: `agent:${a.id}`, label: `Agent: ${a.name}` })),
  ]

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border flex-shrink-0">
        <span className="text-xs text-muted-foreground">{state.id ? 'Edit doc' : 'New doc'}</span>
        {isDirty && <span className="text-[10px] text-yellow-400">● unsaved</span>}
        <div className="ml-auto flex items-center gap-2">
          {state.id && !confirmDelete && (
            <button
              onClick={onDeleteRequest}
              className="text-xs text-muted-foreground hover:text-red-400 transition-colors px-2 py-1"
            >
              Delete
            </button>
          )}
          {confirmDelete && (
            <>
              <span className="text-xs text-red-400">Delete this doc?</span>
              <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white h-6 px-2 text-xs" onClick={onDeleteConfirm} disabled={deleting}>
                {deleting ? '…' : 'Yes, delete'}
              </Button>
              <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={onDeleteCancel}>
                Cancel
              </Button>
            </>
          )}
          {!confirmDelete && (
            <>
              <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={onDiscard}>
                Discard
              </Button>
              <Button size="sm" className="h-6 px-2 text-xs" onClick={onSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Fields */}
      <div className="px-4 py-3 border-b border-border flex-shrink-0 space-y-2">
        <div className="flex gap-3">
          <input
            type="text"
            value={state.title}
            onChange={e => onChange('title', e.target.value)}
            placeholder="Document title…"
            className="flex-1 bg-transparent border-0 border-b border-border text-base font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-violet-500 pb-1"
          />
          <select
            value={state.scope}
            onChange={e => onChange('scope', e.target.value)}
            className="bg-secondary border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-violet-500/50"
          >
            {scopeOptions.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Slug:</span>
          <input
            type="text"
            value={state.slug}
            onChange={e => onChange('slug', e.target.value)}
            placeholder="auto-generated"
            className="flex-1 bg-transparent border-0 text-xs font-mono text-muted-foreground focus:outline-none focus:text-foreground"
          />
        </div>
      </div>

      {/* Content editor */}
      <textarea
        value={state.content}
        onChange={e => onChange('content', e.target.value)}
        placeholder="Write markdown content here…"
        className="flex-1 resize-none bg-transparent px-4 py-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none leading-relaxed"
        spellCheck={false}
      />
    </div>
  )
}

function GraphView({
  data, loading, onRefresh, onSelect, docs,
}: {
  data: { nodes: any[]; edges: any[] } | null
  loading: boolean
  onRefresh: () => void
  onSelect: (doc: BridgeKnowledgeDoc) => void
  docs: BridgeKnowledgeDoc[]
}) {
  if (loading || !data) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {loading ? 'Loading graph…' : 'No graph data'}
      </div>
    )
  }

  // Group nodes by scope
  const byScope: Record<string, any[]> = {}
  for (const n of data.nodes) {
    const s = n.scope ?? 'shared'
    if (!byScope[s]) byScope[s] = []
    byScope[s].push(n)
  }

  const edgesByNode: Record<string, string[]> = {}
  for (const e of data.edges) {
    if (!edgesByNode[e.from]) edgesByNode[e.from] = []
    edgesByNode[e.from].push(e.to)
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-2 border-b border-border flex items-center gap-3 flex-shrink-0">
        <h2 className="text-sm font-medium text-foreground">Knowledge Graph</h2>
        <span className="text-xs text-muted-foreground">{data.nodes.length} docs · {data.edges.length} links</span>
        <Button size="sm" variant="outline" onClick={onRefresh} className="ml-auto h-6 px-2 text-xs">Refresh</Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {data.nodes.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-16">No knowledge docs in the graph yet.</div>
        ) : (
          <div className="space-y-6">
            {Object.entries(byScope).map(([scope, nodes]) => (
              <div key={scope}>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  {scope === 'shared' ? 'Shared' : scope.replace('agent:', 'Agent: ')}
                </h3>
                <div className="grid grid-cols-1 gap-2">
                  {nodes.map((n: any) => {
                    const links = edgesByNode[n.id] ?? []
                    const fullDoc = docs.find(d => d.id === n.id)
                    return (
                      <button
                        key={n.id}
                        onClick={() => fullDoc && onSelect(fullDoc)}
                        className="text-left rounded-lg border border-border bg-card p-3 hover:border-violet-500/50 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-medium text-foreground">{n.title}</span>
                          {links.length > 0 && (
                            <span className="text-[10px] text-violet-400 bg-violet-500/10 rounded px-1.5 py-0.5 flex-shrink-0">
                              {links.length} link{links.length !== 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] font-mono text-muted-foreground mt-0.5">{n.slug}</div>
                        {links.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {links.slice(0, 5).map((targetId: string) => {
                              const target = nodes.find((nn: any) => nn.id === targetId)
                              return target ? (
                                <span key={targetId} className="text-[9px] bg-secondary text-muted-foreground rounded px-1.5 py-0.5">
                                  → {target.title}
                                </span>
                              ) : null
                            })}
                            {links.length > 5 && (
                              <span className="text-[9px] text-muted-foreground">+{links.length - 5} more</span>
                            )}
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
      <div className="text-4xl opacity-20">📚</div>
      <div>
        <p className="text-sm font-medium text-foreground">Mycelium Knowledge Base</p>
        <p className="text-xs text-muted-foreground mt-1">
          Create shared or agent-specific knowledge docs. Agents receive relevant docs automatically during context assembly.
        </p>
      </div>
      <Button onClick={onNew} size="sm">Create your first doc</Button>
    </div>
  )
}
