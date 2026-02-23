// app/src/plugins/page.tsx — Plugins page (coming soon)
export default function PluginsPage() {
    return (
        <div className="page-container">
            <div className="page-header">
                <h1>Plugins</h1>
                <p className="page-subtitle">Extend your agents with third-party integrations and custom workflows.</p>
            </div>

            <div className="coming-soon">
                <div className="coming-soon-icon">🧩</div>
                <h2>Coming Soon</h2>
                <p>The plugin marketplace is currently in development. Soon you'll be able to install integrations for databases, APIs, monitoring, and more.</p>
                <div className="coming-soon-features">
                    <div className="feature-preview">
                        <span className="feature-icon">🔌</span>
                        <span>Custom API connectors</span>
                    </div>
                    <div className="feature-preview">
                        <span className="feature-icon">📊</span>
                        <span>Monitoring dashboards</span>
                    </div>
                    <div className="feature-preview">
                        <span className="feature-icon">🔄</span>
                        <span>Workflow automation</span>
                    </div>
                    <div className="feature-preview">
                        <span className="feature-icon">🏪</span>
                        <span>Community marketplace</span>
                    </div>
                </div>
            </div>
        </div>
    )
}
