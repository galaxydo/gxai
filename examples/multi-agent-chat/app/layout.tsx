import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <head>
                <meta charSet="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>Multi-Agent Chat | GXAI Demo</title>
                <meta name="description" content="Chat with multiple AI agents simultaneously" />
                <link rel="preconnect" href="https://fonts.googleapis.com" />
                <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
                <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
            </head>
            <body>
                <div className="container">
                    <header>
                        <div className="logo">
                            <div className="logo-icon">🤖</div>
                            <div>
                                <h1>Multi-Agent Chat</h1>
                                <span>GXAI Example Application</span>
                            </div>
                        </div>
                        <div className="header-links">
                            <a href="http://localhost:3001" target="_blank">📊 Analytics Dashboard</a>
                        </div>
                    </header>
                    {children}
                </div>
            </body>
        </html>
    );
}
