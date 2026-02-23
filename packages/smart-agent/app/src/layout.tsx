// app/src/layout.tsx — Root layout
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
                <div id="app">
                    {children}
                </div>
            </body>
        </html>
    );
}
