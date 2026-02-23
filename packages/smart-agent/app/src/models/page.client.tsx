// app/src/models/page.client.tsx — Dynamic provider/model cards with API key management
import { render } from 'melina/client'

interface ModelDef {
    id: string; name: string; description: string; tier: string
}
interface ProviderData {
    id: string; name: string; envKey: string; envKeyAlt?: string
    models: ModelDef[]; active: boolean; maskedKey: string; fromEnv: boolean
}

let providers: ProviderData[] = []
let editingProvider: string | null = null
let savingProvider: string | null = null

const TIER_LABELS: Record<string, string> = {
    recommended: '★ RECOMMENDED',
    pro: 'PRO',
    preview: 'PREVIEW',
    stable: 'STABLE',
}

const TIER_COLORS: Record<string, string> = {
    recommended: '#f59e0b',
    pro: '#a78bfa',
    preview: '#34d399',
    stable: '#60a5fa',
}

const PROVIDER_ICONS: Record<string, string> = {
    google: '🔵',
    anthropic: '🟤',
    openai: '🟢',
    deepseek: '🔷',
}

function ProviderCard({ p }: { p: ProviderData }) {
    const isEditing = editingProvider === p.id
    const isSaving = savingProvider === p.id

    return (
        <div className={`provider-card ${p.active ? 'active' : 'inactive'}`}>
            <div className="provider-header">
                <div className="provider-identity">
                    <span className="provider-icon">{PROVIDER_ICONS[p.id] || '⬜'}</span>
                    <div>
                        <h2 className="provider-name">{p.name}</h2>
                        <span className="provider-env-var">{p.envKey}</span>
                    </div>
                </div>
                <div className={`provider-status ${p.active ? 'connected' : ''}`}>
                    <span className="status-dot" />
                    {p.active ? 'Connected' : 'Not configured'}
                </div>
            </div>

            {/* API Key Section */}
            <div className="api-key-section">
                {p.active && !isEditing ? (
                    <div className="key-display">
                        <span className="key-masked">{p.maskedKey}</span>
                        {p.fromEnv && <span className="key-source">from .env</span>}
                        <div className="key-actions">
                            <button className="key-btn key-edit" onClick={() => { editingProvider = p.id; rerender() }}>
                                Change
                            </button>
                            {!p.fromEnv && (
                                <button className="key-btn key-remove" onClick={() => removeKey(p.id)}>
                                    Remove
                                </button>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="key-input-row">
                        <input
                            type="password"
                            className="key-input"
                            id={`key-input-${p.id}`}
                            placeholder={`Paste your ${p.name} API key…`}
                            disabled={isSaving}
                        />
                        <button
                            className={`key-btn key-save ${isSaving ? 'saving' : ''}`}
                            onClick={() => saveKey(p.id)}
                            disabled={isSaving}
                        >
                            {isSaving ? '…' : '✓ Save'}
                        </button>
                        {isEditing && (
                            <button className="key-btn key-cancel" onClick={() => { editingProvider = null; rerender() }}>
                                Cancel
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Model List */}
            <div className={`model-list ${p.active ? '' : 'dimmed'}`}>
                {p.models.map(m => (
                    <div className="model-row" key={m.id}>
                        <div className="model-info">
                            <span className="model-name">{m.name}</span>
                            <span className="model-desc">{m.description}</span>
                        </div>
                        <div className="model-meta">
                            <span className="model-tier" style={`--tier-color: ${TIER_COLORS[m.tier] || '#888'}`}>
                                {TIER_LABELS[m.tier] || m.tier.toUpperCase()}
                            </span>
                            <code className="model-id">{m.id}</code>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}

async function saveKey(providerId: string) {
    const input = document.getElementById(`key-input-${providerId}`) as HTMLInputElement
    const key = input?.value?.trim()
    if (!key) return

    savingProvider = providerId
    rerender()

    try {
        const res = await fetch('/api/models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ providerId, apiKey: key }),
        })
        if (res.ok) {
            editingProvider = null
            await loadProviders()
        }
    } catch (e) {
        console.error('Failed to save key:', e)
    } finally {
        savingProvider = null
        rerender()
    }
}

async function removeKey(providerId: string) {
    try {
        await fetch(`/api/models?providerId=${providerId}`, { method: 'DELETE' })
        await loadProviders()
    } catch (e) {
        console.error('Failed to remove key:', e)
    }
}

async function loadProviders() {
    try {
        providers = await fetch('/api/models').then(r => r.json())
    } catch {
        providers = []
    }
    rerender()
}

function rerender() {
    const grid = document.getElementById('providers-grid')
    if (!grid) return
    render(
        <div className="providers-list">
            {providers.map(p => <ProviderCard p={p} />)}
            {providers.length === 0 && (
                <div className="overview-empty">No providers found.</div>
            )}
        </div>,
        grid
    )
}

export default function mount() {
    loadProviders()
    return () => { }
}
