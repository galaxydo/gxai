// app/src/models/page.tsx — Models & API Key Management
export default function ModelsPage() {
    return (
        <div className="page-container" id="models-page">
            <div className="page-header">
                <h1>AI Models</h1>
                <p className="page-subtitle">Configure your API keys and choose which providers to use.</p>
            </div>
            <div id="providers-grid" className="providers-grid">
                <div className="overview-empty">Loading providers…</div>
            </div>
        </div>
    )
}
