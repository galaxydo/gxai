export default function Layout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <head>
                <meta charSet="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>GXAI Analytics - Agent Inference Dashboard</title>
                <meta name="description" content="GXAI - Real-time analytics and monitoring for AI agent inference requests" />
                <link rel="preconnect" href="https://fonts.googleapis.com" />
                <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
                <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
            </head>
            <body>
                <div className="container">
                    <header>
                        <div className="logo">
                            <div className="logo-icon">🧠</div>
                            <div>
                                <h1>GXAI</h1>
                                <span>Agent Analytics</span>
                            </div>
                        </div>
                        <div className="header-actions">
                            <a href="/" className="btn btn-ghost">
                                🔄 Refresh
                            </a>
                        </div>
                    </header>
                    <main id="melina-page-content">{children}</main>
                </div>
            </body>
        </html>
    );
}
