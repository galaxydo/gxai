// app/src/page.tsx — Workspace layout: nav rail + sidebar + chat + tabbed overview
export default function Page() {
    return (
        <div className="workspace">
            {/* ── Nav Rail (far left) ── */}
            <nav className="nav-rail" id="nav-rail">
                <div className="nav-rail-top">
                    <button className="nav-rail-btn active" data-page="agents" title="Agents">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M5 20v-1a7 7 0 0 1 14 0v1" /><circle cx="12" cy="12" r="10" /></svg>
                        <span>Agents</span>
                    </button>
                    <button className="nav-rail-btn" data-page="models" title="Models">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>
                        <span>Models</span>
                    </button>
                    <button className="nav-rail-btn" data-page="skills" title="Skills">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
                        <span>Skills</span>
                    </button>
                    <button className="nav-rail-btn" data-page="plugins" title="Plugins">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v6m0 8v6M2 12h6m8 0h6" /><circle cx="12" cy="12" r="4" /></svg>
                        <span>Plugins</span>
                    </button>
                </div>
                <div className="nav-rail-bottom">
                    <button className="nav-rail-btn" data-page="settings" title="Settings" id="nav-settings-btn">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                        <span>Settings</span>
                    </button>
                </div>
            </nav>

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
                            <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                            <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                            <option value="gemini-3-flash-preview">gemini-3-flash</option>
                            <option value="gemini-3-pro-preview">gemini-3-pro</option>
                            <option value="gemini-2.0-flash">gemini-2.0-flash</option>
                            <option value="claude-sonnet-4-20250514">claude-sonnet-4</option>
                            <option value="gpt-4o">gpt-4o</option>
                            <option value="deepseek-chat">deepseek</option>
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

            {/* Settings modal — rendered by client, positioned fixed so it doesn't affect grid */}
            <div id="settings-modal" className="settings-modal-container"></div>
        </div>
    )
}
