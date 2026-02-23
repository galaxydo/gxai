// app/src/page.tsx — Agents workspace (home page)
export default function Page() {
    return (
        <div className="agents-page">
            {/* ── Sidebar ── */}
            <aside className="sidebar" id="sidebar">
                <button className="sidebar-new-btn" id="new-agent-btn">
                    <span>New Agent</span>
                    <span className="sidebar-new-icon">+</span>
                </button>

                <div className="sidebar-agents" id="agent-list">
                    {/* Dynamically populated by client */}
                </div>

                <div className="sidebar-bottom">
                    <div className="sidebar-bottom-icons">
                        <button className="sidebar-icon-btn" id="settings-btn" title="Settings">⚙</button>
                    </div>
                </div>
            </aside>

            {/* ── Main Area ── */}
            <div className="main-area">
                {/* Agent Header */}
                <header className="agent-header" id="agent-header">
                    <div className="agent-header-left">
                        <span className="agent-status-dot active" id="agent-status-dot" />
                        <span className="agent-header-name" id="agent-header-name">Select or create an agent</span>
                    </div>
                    <div className="agent-header-actions">
                        <button className="header-icon-btn" id="export-chat-btn" title="Export chat as Markdown">⬇</button>
                        <button className="header-icon-btn" id="clear-chat-btn" title="Clear chat (Ctrl+L)">🗑</button>
                    </div>
                    <div className="agent-header-right">
                        <select className="model-select" id="model-select">
                            {/* Populated dynamically from /api/models — only active providers */}
                            <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                        </select>
                        <div id="skill-toggles" className="skill-toggles" />
                    </div>
                </header>

                {/* Chat + Input */}
                <div className="chat-section">
                    <div className="chat-area" id="chat-area">
                        <div className="empty-state" id="empty-state">
                            <div className="empty-icon">🤖</div>
                            <h2>Smart Agent Workspace</h2>
                            <p>Create a new agent or select one from the sidebar, then describe what you want it to do.</p>
                            <div className="example-chips">
                                <button className="example-chip" data-prompt="tell me a short joke">🎭 tell me a joke</button>
                                <button className="example-chip" data-prompt="list all files in the current directory">📂 list files here</button>
                                <button className="example-chip" data-prompt="create a hello.txt file that says Hello World">📝 create hello.txt</button>
                                <button className="example-chip" data-prompt="what version of bun is installed?">⚡ bun version</button>
                            </div>
                        </div>
                    </div>

                    <div className="input-area">
                        <div className="input-row">
                            <textarea className="input-field" id="input" rows={1} placeholder="Type your command or question..." />
                            <button className="send-btn" id="send-btn">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>

                {/* ── Overview Panel (tabs) ── */}
                <div className="overview" id="overview">
                    <div className="overview-resize" id="overview-resize" />
                    <div className="tab-bar" id="tab-bar">
                        <button className="tab active" data-tab="objectives">Objectives</button>
                        <button className="tab" data-tab="files">Files</button>
                        <button className="tab" data-tab="schedule">Schedule</button>
                    </div>
                    <div className="tab-content" id="tab-content">
                        <div className="tab-pane active" id="pane-objectives">
                            <div className="overview-empty">No objectives yet. Send a message to start planning.</div>
                        </div>
                        <div className="tab-pane" id="pane-files">
                            <div className="overview-empty">No files touched yet.</div>
                        </div>
                        <div className="tab-pane" id="pane-schedule">
                            <div className="overview-empty">No scheduled tasks yet.</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Settings modal */}
            <div id="settings-modal" className="settings-modal-container"></div>
        </div>
    )
}
