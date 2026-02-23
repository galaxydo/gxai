// app/src/models/page.tsx — Models configuration page
const MODELS = [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'Google', desc: 'Fast, efficient model for most tasks. Best balance of speed and quality.', tier: 'recommended' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'Google', desc: 'Advanced reasoning with extended thinking for complex problems.', tier: 'pro' },
    { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', provider: 'Google', desc: 'Next-gen speed. Preview access to the latest architecture.', tier: 'preview' },
    { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro', provider: 'Google', desc: 'Most capable model. Preview access with advanced agentic capabilities.', tier: 'preview' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'Google', desc: 'Stable workhorse. Reliable for production workloads.', tier: 'stable' },
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'Anthropic', desc: 'Excellent at nuanced writing and careful analysis.', tier: 'pro' },
    { id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI', desc: 'Multimodal model with strong general capabilities.', tier: 'pro' },
    { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'DeepSeek', desc: 'Open-weight model. Strong coding and reasoning at lower cost.', tier: 'stable' },
]

function TierBadge({ tier }: { tier: string }) {
    const labels: Record<string, string> = {
        recommended: '★ Recommended',
        pro: 'Pro',
        preview: 'Preview',
        stable: 'Stable',
    }
    return <span className={`tier-badge tier-${tier}`}>{labels[tier] || tier}</span>
}

export default function ModelsPage() {
    return (
        <div className="page-container">
            <div className="page-header">
                <h1>AI Models</h1>
                <p className="page-subtitle">Available models for your agents. Each agent selects its model from the chat header.</p>
            </div>

            <div className="model-grid">
                {MODELS.map(m => (
                    <div className="model-card" key={m.id}>
                        <div className="model-card-header">
                            <div className="model-card-title">
                                <h3>{m.name}</h3>
                                <span className="model-provider">{m.provider}</span>
                            </div>
                            <TierBadge tier={m.tier} />
                        </div>
                        <p className="model-card-desc">{m.desc}</p>
                        <code className="model-card-id">{m.id}</code>
                    </div>
                ))}
            </div>
        </div>
    )
}
