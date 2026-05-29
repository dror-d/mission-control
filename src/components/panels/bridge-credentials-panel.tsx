'use client'

import { useCallback, useEffect, useState } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Credential {
  id: string
  provider: string
  display_name: string
  auth_type: string
  scopes: string[]
  status: string
  created_at: string
  updated_at: string
  last_used_at: string | null
}

// ── Provider templates ─────────────────────────────────────────────────────────

type ProviderKey = 'telegram' | 'openai' | 'custom'

interface ProviderTemplateField {
  key: string
  label: string
  placeholder: string
}

interface ProviderTemplate {
  label: string
  provider: string       // value sent to API
  auth_type: string
  defaultDisplayName: string
  fields: ProviderTemplateField[]
  buildSecret: (vals: Record<string, string>) => Record<string, string>
}

const PROVIDER_TEMPLATES: Record<ProviderKey, ProviderTemplate> = {
  telegram: {
    label: 'Telegram',
    provider: 'telegram',
    auth_type: 'bot_token',
    defaultDisplayName: 'Telegram Bot',
    fields: [{ key: 'bot_token', label: 'Bot Token', placeholder: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11' }],
    buildSecret: vals => ({ bot_token: vals.bot_token ?? '' }),
  },
  openai: {
    label: 'OpenAI',
    provider: 'openai',
    auth_type: 'api_key',
    defaultDisplayName: 'OpenAI API Key',
    fields: [{ key: 'api_key', label: 'API Key', placeholder: 'sk-...' }],
    buildSecret: vals => ({ api_key: vals.api_key ?? '' }),
  },
  custom: {
    label: 'Custom',
    provider: '',
    auth_type: 'api_key',
    defaultDisplayName: '',
    fields: [],
    buildSecret: () => ({}),
  },
}

function guessProviderKey(provider: string): ProviderKey {
  const p = provider.toLowerCase()
  if (p === 'telegram') return 'telegram'
  if (p === 'openai') return 'openai'
  return 'custom'
}

// ── Credential form ────────────────────────────────────────────────────────────

interface CredFormState {
  provider_key: ProviderKey
  provider: string           // actual value sent to API (editable only for custom)
  display_name: string
  auth_type: string
  scopes_raw: string         // comma-separated
  template_fields: Record<string, string>  // friendly field values for known providers
  secret_raw: string         // backing JSON (always kept in sync with template_fields)
  use_advanced_json: boolean // show raw JSON editor alongside template fields
  replace_secret: boolean    // for edit mode: whether to replace the secret
}

function defaultForm(existing?: Credential): CredFormState {
  if (existing) {
    const key = guessProviderKey(existing.provider)
    return {
      provider_key: key,
      provider: existing.provider,
      display_name: existing.display_name,
      auth_type: existing.auth_type,
      scopes_raw: existing.scopes.join(', '),
      template_fields: {},
      secret_raw: '{}',
      use_advanced_json: false,
      replace_secret: false,
    }
  }
  return {
    provider_key: 'custom',
    provider: '',
    display_name: '',
    auth_type: 'api_key',
    scopes_raw: '',
    template_fields: {},
    secret_raw: '{\n  "api_key": ""\n}',
    use_advanced_json: false,
    replace_secret: true,
  }
}

function CredentialForm({
  existing,
  onSave,
  onCancel,
}: {
  existing?: Credential
  onSave: (form: CredFormState) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm] = useState<CredFormState>(() => defaultForm(existing))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEdit = !!existing
  const tpl = PROVIDER_TEMPLATES[form.provider_key]
  const isTemplate = form.provider_key !== 'custom'

  function handleProviderChange(key: ProviderKey) {
    const next = PROVIDER_TEMPLATES[key]
    const initFields: Record<string, string> = {}
    for (const f of next.fields) initFields[f.key] = ''
    const secretObj = next.buildSecret(initFields)
    setForm(f => ({
      ...f,
      provider_key: key,
      provider: key === 'custom' ? '' : next.provider,
      auth_type: next.auth_type,
      display_name: f.display_name || next.defaultDisplayName,
      template_fields: initFields,
      secret_raw: key === 'custom'
        ? '{\n  "api_key": ""\n}'
        : JSON.stringify(secretObj, null, 2),
      use_advanced_json: false,
    }))
  }

  function handleTemplateField(fieldKey: string, value: string) {
    const nextFields = { ...form.template_fields, [fieldKey]: value }
    const secretObj = tpl.buildSecret(nextFields)
    setForm(f => ({
      ...f,
      template_fields: nextFields,
      secret_raw: JSON.stringify(secretObj, null, 2),
    }))
  }

  // In replace-secret mode for a known provider, initialise template_fields from
  // the secret_raw JSON if it hasn't been touched yet.
  function handleReplaceSecretToggle(checked: boolean) {
    const tplNext = PROVIDER_TEMPLATES[form.provider_key]
    const initFields: Record<string, string> = {}
    for (const f of tplNext.fields) initFields[f.key] = ''
    setForm(f => ({
      ...f,
      replace_secret: checked,
      template_fields: checked ? initFields : {},
      secret_raw: checked
        ? (f.provider_key === 'custom' ? '{}' : JSON.stringify(tplNext.buildSecret(initFields), null, 2))
        : '',
    }))
  }

  async function handleSave() {
    if (!form.display_name.trim()) { setError('Display name is required'); return }
    if (!form.provider.trim()) { setError('Provider is required'); return }
    if (!isTemplate && !form.auth_type.trim()) { setError('Auth type is required'); return }
    if (!isEdit || form.replace_secret) {
      if (!form.secret_raw.trim()) { setError('Secret payload is required'); return }
      try { JSON.parse(form.secret_raw) } catch { setError('Secret payload must be valid JSON'); return }
      // For templates, ensure all required fields have values
      if (isTemplate) {
        for (const f of tpl.fields) {
          if (!form.template_fields[f.key]?.trim()) {
            setError(`${f.label} is required`)
            return
          }
        }
      }
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(form)
    } catch (e: any) {
      setError(e?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const inputClass = 'w-full px-3 py-1.5 text-sm rounded border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'

  const showSecretSection = !isEdit || form.replace_secret

  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-4 max-w-lg">
      <div className="text-sm font-semibold text-foreground">
        {isEdit ? `Edit: ${existing!.display_name}` : 'New credential'}
      </div>

      {/* Provider selector (create) or read-only display (edit) */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Provider *</label>
        {isEdit ? (
          <div className="px-3 py-1.5 text-sm rounded border border-border bg-muted/30 text-muted-foreground">
            {existing!.provider}
          </div>
        ) : (
          <select
            value={form.provider_key}
            onChange={e => handleProviderChange(e.target.value as ProviderKey)}
            className={inputClass}
          >
            <option value="telegram">Telegram</option>
            <option value="openai">OpenAI</option>
            <option value="custom">Custom</option>
          </select>
        )}
      </div>

      {/* Custom provider text input */}
      {form.provider_key === 'custom' && !isEdit && (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Provider name *</label>
          <input
            type="text"
            value={form.provider}
            onChange={e => setForm(f => ({ ...f, provider: e.target.value }))}
            placeholder="e.g. my-service"
            className={inputClass}
          />
        </div>
      )}

      <div className="space-y-3">
        {/* Display name */}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Display name *</label>
          <input
            type="text"
            value={form.display_name}
            onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
            placeholder={tpl.defaultDisplayName || 'e.g. My API Key'}
            className={inputClass}
          />
        </div>

        {/* Auth type — only for custom providers */}
        {!isTemplate && (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Auth type *</label>
            <input
              type="text"
              value={form.auth_type}
              onChange={e => setForm(f => ({ ...f, auth_type: e.target.value }))}
              placeholder="e.g. api_key"
              className={inputClass}
            />
          </div>
        )}

        {/* Scopes — only for custom providers */}
        {!isTemplate && (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Scopes (comma-separated, optional)</label>
            <input
              type="text"
              value={form.scopes_raw}
              onChange={e => setForm(f => ({ ...f, scopes_raw: e.target.value }))}
              placeholder="read, write, send_messages"
              className={inputClass}
            />
          </div>
        )}
      </div>

      {/* Secret payload */}
      <div className="space-y-2">
        {isEdit && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.replace_secret}
              onChange={e => handleReplaceSecretToggle(e.target.checked)}
              className="rounded"
            />
            <span className="text-xs text-muted-foreground">Replace stored secret</span>
          </label>
        )}

        {showSecretSection ? (
          <div className="space-y-3">
            {/* Template fields for known providers */}
            {isTemplate && tpl.fields.map(f => (
              <div key={f.key} className="space-y-1">
                <label className="text-xs text-muted-foreground">{f.label} *</label>
                <input
                  type="password"
                  value={form.template_fields[f.key] ?? ''}
                  onChange={e => handleTemplateField(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  autoComplete="off"
                  className={inputClass}
                />
              </div>
            ))}

            {/* Custom: always show JSON; Template: show toggle */}
            {!isTemplate ? (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Secret payload (JSON) *</label>
                <textarea
                  value={form.secret_raw}
                  onChange={e => setForm(f => ({ ...f, secret_raw: e.target.value }))}
                  rows={5}
                  spellCheck={false}
                  className="w-full px-3 py-2 text-xs font-mono rounded border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                />
              </div>
            ) : (
              <div>
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, use_advanced_json: !f.use_advanced_json }))}
                  className="flex items-center gap-1 text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors"
                >
                  <span className="font-mono">{form.use_advanced_json ? '▾' : '▸'}</span>
                  Advanced JSON
                </button>
                {form.use_advanced_json && (
                  <div className="mt-2 space-y-1">
                    <textarea
                      value={form.secret_raw}
                      onChange={e => setForm(f => ({ ...f, secret_raw: e.target.value }))}
                      rows={4}
                      spellCheck={false}
                      className="w-full px-3 py-2 text-xs font-mono rounded border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                    />
                    <div className="text-xs text-muted-foreground/60">
                      Raw JSON — overrides the fields above.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground italic">
            Secret is stored encrypted. Check "Replace stored secret" to enter a new value.
          </div>
        )}
      </div>

      {error && (
        <div className="text-xs text-destructive">{error}</div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 text-xs font-medium rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-1.5 text-xs font-medium rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Credential card ────────────────────────────────────────────────────────────

function CredentialCard({
  cred,
  onEdit,
  onDelete,
}: {
  cred: Credential
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-sm text-foreground truncate">{cred.display_name}</div>
          <div className="font-mono text-xs text-muted-foreground/60 truncate">{cred.id}</div>
        </div>
        <span className="flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/20">
          {cred.status}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
        <span className="inline-flex items-center px-2 py-0.5 rounded bg-muted border border-border font-medium">
          {cred.provider}
        </span>
        <span className="inline-flex items-center px-2 py-0.5 rounded bg-muted border border-border">
          {cred.auth_type}
        </span>
        {cred.scopes.map(s => (
          <span key={s} className="inline-flex items-center px-2 py-0.5 rounded bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20">
            {s}
          </span>
        ))}
      </div>

      <div className="text-xs text-muted-foreground/50">
        Created {new Date(cred.created_at).toLocaleDateString()}
        {cred.last_used_at && ` · Last used ${new Date(cred.last_used_at).toLocaleDateString()}`}
      </div>

      <div className="flex gap-3 pt-0.5">
        <button
          onClick={onEdit}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
        >
          Edit
        </button>
        <button
          onClick={onDelete}
          className="text-xs text-destructive/70 hover:text-destructive transition-colors underline underline-offset-2"
        >
          Delete
        </button>
      </div>
    </div>
  )
}

// ── Main panel ─────────────────────────────────────────────────────────────────

export function BridgeCredentialsPanel() {
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    fetch('/api/bridge/credentials')
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(d => setCredentials(d.credentials ?? []))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  function parseScopes(raw: string): string[] {
    return raw.split(',').map(s => s.trim()).filter(Boolean)
  }

  async function handleCreate(form: CredFormState) {
    const secret = JSON.parse(form.secret_raw)
    const res = await fetch('/api/bridge/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: form.provider.trim(),
        display_name: form.display_name.trim(),
        auth_type: form.auth_type.trim(),
        scopes: parseScopes(form.scopes_raw),
        secret_payload: secret,
      }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error(d.error ?? res.statusText)
    }
    setCreating(false)
    load()
  }

  async function handleUpdate(id: string, form: CredFormState) {
    const body: Record<string, unknown> = {
      display_name: form.display_name.trim(),
      auth_type: form.auth_type.trim(),
      scopes: parseScopes(form.scopes_raw),
    }
    if (form.replace_secret) {
      body.secret_payload = JSON.parse(form.secret_raw)
    }
    const res = await fetch(`/api/bridge/credentials/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error(d.error ?? res.statusText)
    }
    setEditingId(null)
    load()
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/bridge/credentials/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? res.statusText)
      }
      load()
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Credentials</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Encrypted secrets that can be linked to tool instances. Secrets are stored with AES-256-GCM
            and never returned by the API.
          </p>
        </div>
        {!creating && !editingId && (
          <button
            onClick={() => setCreating(true)}
            className="flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
          >
            + New credential
          </button>
        )}
      </div>

      {/* Security notice */}
      <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 px-4 py-3 text-xs text-blue-700 dark:text-blue-400 space-y-1">
        <div className="font-semibold">Security model</div>
        <ul className="list-disc list-inside space-y-0.5">
          <li>Secrets are encrypted with AES-256-GCM before being written to SQLite.</li>
          <li>The API never returns decrypted secret payloads.</li>
          <li>Set <code className="font-mono bg-blue-500/10 px-1 rounded">MYCELIUM_CREDENTIALS_KEY</code> in the bridge environment to enable credential storage.</li>
        </ul>
      </div>

      {/* Create form */}
      {creating && (
        <CredentialForm
          onSave={handleCreate}
          onCancel={() => setCreating(false)}
        />
      )}

      {/* Loading */}
      {loading && (
        <div className="text-sm text-muted-foreground animate-pulse">Loading credentials…</div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive space-y-1">
          <div className="font-medium">Error</div>
          <div className="text-xs">{error}</div>
          <button onClick={load} className="text-xs underline underline-offset-2">Retry</button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && credentials.length === 0 && !creating && (
        <div className="rounded-lg border border-border bg-muted/20 px-4 py-10 text-center space-y-2 text-sm text-muted-foreground">
          <div className="font-medium">No credentials stored</div>
          <div className="text-xs">
            Create a credential to link secrets to tool instances.
            Make sure <code className="font-mono bg-muted px-1 rounded">MYCELIUM_CREDENTIALS_KEY</code> is set in the bridge environment.
          </div>
        </div>
      )}

      {/* Credential list */}
      {!loading && credentials.length > 0 && (
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
            {credentials.length} credential{credentials.length !== 1 ? 's' : ''}
          </div>
          {credentials.map(cred => (
            <div key={cred.id}>
              {editingId === cred.id ? (
                <CredentialForm
                  existing={cred}
                  onSave={form => handleUpdate(cred.id, form)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <CredentialCard
                  cred={cred}
                  onEdit={() => setEditingId(cred.id)}
                  onDelete={() => {
                    if (confirm(`Delete credential "${cred.display_name}"? This cannot be undone.`)) {
                      handleDelete(cred.id)
                    }
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
