// app/src/layout.tsx — Root layout with persistent nav rail
export default function RootLayout({ children }: { children: any }) {
    return (
        <html lang="en">
            <head>
                <meta charSet="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <title>smart-agent</title>
                <meta name="description" content="Autonomous AI agent with dynamic objectives" />
            </head>
            <body>
                <div id="app" className="app-shell">
                    {/* ── Nav Rail (persistent across pages) ── */}
                    <nav className="nav-rail" id="nav-rail">
                        <div className="nav-rail-top">
                            <a className="nav-rail-btn" href="/" data-page="agents" title="Agents">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M5 20v-1a7 7 0 0 1 14 0v1" /><circle cx="12" cy="12" r="10" /></svg>
                                <span>Agents</span>
                            </a>
                            <a className="nav-rail-btn" href="/models" data-page="models" title="Models">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>
                                <span>Models</span>
                            </a>
                            <a className="nav-rail-btn" href="/skills" data-page="skills" title="Skills">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
                                <span>Skills</span>
                            </a>
                            <a className="nav-rail-btn" href="/plugins" data-page="plugins" title="Plugins">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v6m0 8v6M2 12h6m8 0h6" /><circle cx="12" cy="12" r="4" /></svg>
                                <span>Plugins</span>
                            </a>
                        </div>
                        <div className="nav-rail-bottom">
                            <button className="nav-rail-btn" title="Settings" id="nav-settings-btn">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                                <span>Settings</span>
                            </button>
                        </div>
                    </nav>

                    {/* Page content */}
                    {children}
                </div>
            </body>
        </html>
    );
}
