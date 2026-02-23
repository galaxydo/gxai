// app/src/api/models/route.ts — Provider & model management API
import { join } from 'path'
import { measure, measureSync } from 'measure-fn'

// ── Provider definitions ──

export interface ModelDef {
    id: string
    name: string
    description: string
    tier: 'recommended' | 'pro' | 'preview' | 'stable'
}

export interface ProviderDef {
    id: string
    name: string
    envKey: string // primary env var name
    envKeyAlt?: string // fallback env var name
    models: ModelDef[]
}

const PROVIDERS: ProviderDef[] = [
    {
        id: 'google',
        name: 'Google',
        envKey: 'GEMINI_API_KEY',
        envKeyAlt: 'GOOGLE_API_KEY',
        models: [
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Fast, efficient model for most tasks. Best balance of speed and quality.', tier: 'recommended' },
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Advanced reasoning with extended thinking for complex problems.', tier: 'pro' },
            { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', description: 'Next-gen speed. Preview access to the latest architecture.', tier: 'preview' },
            { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro', description: 'Most capable model. Preview access with advanced agentic capabilities.', tier: 'preview' },
            { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'Stable workhorse. Reliable for production workloads.', tier: 'stable' },
        ],
    },
    {
        id: 'anthropic',
        name: 'Anthropic',
        envKey: 'ANTHROPIC_API_KEY',
        models: [
            { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', description: 'Excellent at nuanced writing and careful analysis.', tier: 'pro' },
        ],
    },
    {
        id: 'openai',
        name: 'OpenAI',
        envKey: 'OPENAI_API_KEY',
        models: [
            { id: 'gpt-4o', name: 'GPT-4o', description: 'Multimodal model with strong general capabilities.', tier: 'pro' },
            { id: 'gpt-4.1', name: 'GPT-4.1', description: 'Latest reasoning model with deep analysis capabilities.', tier: 'pro' },
        ],
    },
    {
        id: 'deepseek',
        name: 'DeepSeek',
        envKey: 'DEEPSEEK_API_KEY',
        models: [
            { id: 'deepseek-chat', name: 'DeepSeek Chat', description: 'Open-weight model. Strong coding and reasoning at lower cost.', tier: 'stable' },
        ],
    },
]

// ── Persistent key storage ──
// Store keys in a JSON file alongside the DB

const KEYS_PATH = join(process.cwd(), '.smart-agent-keys.json')

async function loadKeys(): Promise<Record<string, string>> {
    try {
        const file = Bun.file(KEYS_PATH)
        if (await file.exists()) {
            return JSON.parse(await file.text())
        }
    } catch { }
    return {}
}

async function saveKeys(keys: Record<string, string>) {
    await Bun.write(KEYS_PATH, JSON.stringify(keys, null, 2))
}

// Apply saved keys to process.env on server start
let _keysApplied = false
async function applyKeys() {
    if (_keysApplied) return
    _keysApplied = true
    const keys = await loadKeys()
    for (const [envVar, value] of Object.entries(keys)) {
        if (value && !process.env[envVar]) {
            process.env[envVar] = value
        }
    }
}

// Eagerly apply on module load
applyKeys()

// ── GET /api/models — List providers + their active status ──

export async function GET() {
    await applyKeys()
    const keys = await loadKeys()

    const providers = PROVIDERS.map(p => {
        const hasKey = !!(
            process.env[p.envKey] ||
            (p.envKeyAlt && process.env[p.envKeyAlt]) ||
            keys[p.envKey]
        )
        // Mask the key for display — show last 4 chars only
        const rawKey = keys[p.envKey] || process.env[p.envKey] || (p.envKeyAlt && process.env[p.envKeyAlt]) || ''
        const maskedKey = rawKey ? '•'.repeat(Math.max(0, rawKey.length - 4)) + rawKey.slice(-4) : ''

        return {
            ...p,
            active: hasKey,
            maskedKey,
            fromEnv: !keys[p.envKey] && !!(process.env[p.envKey] || (p.envKeyAlt && process.env[p.envKeyAlt])),
        }
    })

    return Response.json(providers)
}

// ── POST /api/models — Save an API key for a provider ──

export async function POST(req: Request) {
    const body = await req.json() as { providerId: string; apiKey: string }
    if (!body.providerId) return Response.json({ error: 'Missing providerId' }, { status: 400 })

    const provider = PROVIDERS.find(p => p.id === body.providerId)
    if (!provider) return Response.json({ error: 'Unknown provider' }, { status: 400 })

    const keys = await loadKeys()

    if (body.apiKey) {
        // Set key
        keys[provider.envKey] = body.apiKey
        process.env[provider.envKey] = body.apiKey
    } else {
        // Remove key
        delete keys[provider.envKey]
        delete process.env[provider.envKey]
    }

    await saveKeys(keys)

    return Response.json({ ok: true, active: !!body.apiKey })
}

// ── DELETE /api/models?providerId=x — Remove an API key ──

export async function DELETE(req: Request) {
    const url = new URL(req.url)
    const providerId = url.searchParams.get('providerId')
    if (!providerId) return Response.json({ error: 'Missing providerId' }, { status: 400 })

    const provider = PROVIDERS.find(p => p.id === providerId)
    if (!provider) return Response.json({ error: 'Unknown provider' }, { status: 400 })

    const keys = await loadKeys()
    delete keys[provider.envKey]
    delete process.env[provider.envKey]
    await saveKeys(keys)

    return Response.json({ ok: true })
}
