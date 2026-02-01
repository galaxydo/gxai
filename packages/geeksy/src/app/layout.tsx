import './globals.css';

export default function RootLayout({ children }: { children: any }) {
    return (
        <html lang="en">
            <head>
                <meta charSet="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>Geeksy - Agent Orchestration</title>
                <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
            </head>
            <body style={{ margin: 0, padding: 0 }}>
                <div id="melina-page-content">
                    {children}
                </div>
            </body>
        </html>
    );
}
