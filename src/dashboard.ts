import { EventBus, globalBus as defaultGlobalBus } from './event-bus';
import { CostTracker, costTracker as defaultCostTracker } from './cost-tracker';
import { MetricsCollector } from './metrics';
import type { CostSummary } from './cost-tracker';

export interface DashboardOptions {
    /** Port to run the standalone dashboard on (default: 3000) */
    port?: number;
    /** Override the default global event bus if using a custom instance */
    bus?: EventBus;
    /** Override the default cost tracker */
    costTracker?: CostTracker;
    /** Optional metrics collector to surface custom metrics */
    metrics?: MetricsCollector;
    /** Custom title for the dashboard tab */
    title?: string;
}

const HTML_TEMPLATE = (title: string) => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fira+Code:wght@400;500&display=swap');
        
        :root {
            --bg-base: #0a0a0c;
            --bg-glass: rgba(20, 20, 25, 0.7);
            --bg-glass-hover: rgba(30, 30, 40, 0.8);
            --border-glass: rgba(255, 255, 255, 0.08);
            --text-main: #f0f0f5;
            --text-muted: #8a8a9a;
            --accent-primary: #6366f1;
            --accent-glow: rgba(99, 102, 241, 0.3);
            --success: #10b981;
            --warning: #f59e0b;
            --error: #ef4444;
            --font-sans: 'Inter', system-ui, sans-serif;
            --font-mono: 'Fira Code', monospace;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }
        
        body {
            background-color: var(--bg-base);
            color: var(--text-main);
            font-family: var(--font-sans);
            line-height: 1.5;
            min-height: 100vh;
            background-image: 
                radial-gradient(circle at 15% 50%, rgba(99, 102, 241, 0.08), transparent 25%),
                radial-gradient(circle at 85% 30%, rgba(16, 185, 129, 0.05), transparent 25%);
            background-attachment: fixed;
            -webkit-font-smoothing: antialiased;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 2rem;
            display: grid;
            grid-template-columns: 350px 1fr;
            gap: 2rem;
            height: 100vh;
        }

        header {
            grid-column: 1 / -1;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding-bottom: 1rem;
            border-bottom: 1px solid var(--border-glass);
            height: fit-content;
        }

        h1 {
            font-size: 1.5rem;
            font-weight: 600;
            letter-spacing: -0.02em;
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }
        h1::before {
            content: '';
            display: block;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background-color: var(--success);
            box-shadow: 0 0 12px var(--success);
            animation: pulse 2s infinite;
        }

        @keyframes pulse {
            0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
            70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); }
            100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }

        .glass-panel {
            background: var(--bg-glass);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border: 1px solid var(--border-glass);
            border-radius: 16px;
            padding: 1.5rem;
            display: flex;
            flex-direction: column;
            gap: 1.5rem;
            overflow: hidden;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 1rem;
        }

        .stat-card {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid var(--border-glass);
            border-radius: 12px;
            padding: 1rem;
            transition: transform 0.2s ease, background 0.2s ease;
        }
        .stat-card:hover {
            transform: translateY(-2px);
            background: rgba(255, 255, 255, 0.05);
        }

        .stat-label {
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--text-muted);
            margin-bottom: 0.5rem;
        }

        .stat-value {
            font-size: 1.5rem;
            font-weight: 700;
            font-variant-numeric: tabular-nums;
        }

        .stat-value.mono { font-family: var(--font-mono); }
        
        .events-stream {
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
            overflow-y: auto;
            padding-right: 0.5rem;
            height: calc(100vh - 12rem);
        }

        /* Custom Scrollbar */
        .events-stream::-webkit-scrollbar { width: 6px; }
        .events-stream::-webkit-scrollbar-track { background: transparent; }
        .events-stream::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 4px; }
        .events-stream::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.2); }

        .event-card {
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid var(--border-glass);
            border-radius: 10px;
            padding: 1rem;
            font-family: var(--font-mono);
            font-size: 0.85rem;
            animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            opacity: 0;
            transform: translateY(10px);
            transition: background 0.2s ease;
        }
        .event-card:hover { background: rgba(255, 255, 255, 0.04); }

        @keyframes slideIn {
            to { opacity: 1; transform: translateY(0); }
        }

        .event-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 0.5rem;
            color: var(--text-muted);
            font-size: 0.75rem;
        }

        .event-type {
            color: var(--accent-primary);
            font-weight: 600;
            padding: 0.2rem 0.5rem;
            background: rgba(99, 102, 241, 0.1);
            border-radius: 4px;
        }

        .event-payload {
            color: #d1d5db;
            word-break: break-all;
            white-space: pre-wrap;
        }

        .event-payload .string { color: #a78bfa; }
        .event-payload .number { color: #34d399; }
        .event-payload .boolean { color: #fbbf24; }
        .event-payload .key { color: #60a5fa; }
        
        .connection-status {
            font-size: 0.85rem;
            color: var(--text-muted);
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .badge {
            display: inline-block;
            padding: 0.2rem 0.5rem;
            border-radius: 4px;
            font-size: 0.7rem;
            font-weight: 600;
            text-transform: uppercase;
        }
        .badge.error { background: rgba(239, 68, 68, 0.1); color: var(--error); border: 1px solid rgba(239, 68, 68, 0.2); }
        .badge.success { background: rgba(16, 185, 129, 0.1); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.2); }

    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>${title}</h1>
            <div class="connection-status" id="connStatus">Connecting to Stream...</div>
        </header>

        <div class="glass-panel">
            <h2 style="font-size: 1rem; color: var(--text-muted);">Overview Metrics</h2>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-label">Total Cost</div>
                    <div class="stat-value mono" id="statCost">$0.000</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Total Runs</div>
                    <div class="stat-value mono" id="statRuns">0</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Tokens Used</div>
                    <div class="stat-value mono" id="statTokens">0</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Avg Latency</div>
                    <div class="stat-value mono" id="statLatency">0ms</div>
                </div>
            </div>
            
            <h2 style="font-size: 1rem; color: var(--text-muted); margin-top: 1rem;">Models Breakdown</h2>
            <div id="modelsBreakdown" style="display: flex; flex-direction: column; gap: 0.5rem; font-family: var(--font-mono); font-size: 0.85rem;">
                <div style="color: var(--text-muted); text-align: center; padding: 1rem;">Waiting for data...</div>
            </div>
        </div>

        <div class="glass-panel" style="padding: 1rem;">
            <div style="padding: 0.5rem 0.5rem 1rem 0.5rem; display: flex; justify-content: space-between; align-items: center;">
                <h2 style="font-size: 1rem; color: var(--text-muted);">Live Event Stream</h2>
                <div style="font-size: 0.75rem; color: var(--text-muted);" id="eventCount">0 events</div>
            </div>
            <div class="events-stream" id="eventStream">
                <!-- Events injection -->
            </div>
        </div>
    </div>

    <script>
        const formatNumber = (num) => new Intl.NumberFormat('en-US').format(num);
        const formatMoney = (num) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 3 }).format(num);
        
        // Syntax highlighting for JSON
        function syntaxHighlight(json) {
            if (typeof json != 'string') {
                json = JSON.stringify(json, undefined, 2);
            }
            json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return json.replace(/("(\\\\u[a-zA-Z0-9]{4}|\\\\[^u]|[^\\\\"])*"(\\s*:)?|\\b(true|false|null)\\b|-?\\d+(?:\\.\\d*)?(?:[eE][+\\-]?\\d+)?)/g, function (match) {
                var cls = 'number';
                if (/^"/.test(match)) {
                    if (/:$/.test(match)) {
                        cls = 'key';
                        match = match.replace(/'/g, '');
                    } else {
                        cls = 'string';
                    }
                } else if (/true|false/.test(match)) {
                    cls = 'boolean';
                } else if (/null/.test(match)) {
                    cls = 'null';
                }
                return '<span class="' + cls + '">' + match + '</span>';
            });
        }

        const streamEl = document.getElementById('eventStream');
        const connStatus = document.getElementById('connStatus');
        let totalEvents = 0;

        function addEvent(evtName, payload) {
            totalEvents++;
            document.getElementById('eventCount').innerText = \`\${totalEvents} events\`;

            const card = document.createElement('div');
            card.className = 'event-card';
            
            const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit', fractionalSecondDigits: 3 });
            
            let badgeHtml = '';
            if (payload.error || payload.status === 'error' || !payload.success && payload.success !== undefined) {
                badgeHtml = '<span class="badge error">ERROR</span>';
            } else if (payload.status === 'success' || payload.success) {
                badgeHtml = '<span class="badge success">SUCCESS</span>';
            }

            card.innerHTML = \`
                <div class="event-header">
                    <div style="display: flex; gap: 0.5rem; align-items: center;">
                        <span class="event-type">\${evtName}</span>
                        \${badgeHtml}
                    </div>
                    <span>\${timeStr}</span>
                </div>
                <div class="event-payload">\${syntaxHighlight(payload)}</div>
            \`;
            
            streamEl.prepend(card);

            // Keep only latest 100 DOM elements to prevent memory leaks
            if (streamEl.children.length > 100) {
                streamEl.lastChild.remove();
            }
        }

        function updateMetrics(summary) {
            document.getElementById('statCost').innerText = formatMoney(summary.totalCostUSD);
            document.getElementById('statRuns').innerText = formatNumber(summary.totalRuns);
            document.getElementById('statTokens').innerText = formatNumber(summary.totalTokens);
            document.getElementById('statLatency').innerText = formatNumber(summary.avgDurationMs) + 'ms';

            const modelsBreakdown = document.getElementById('modelsBreakdown');
            if (Object.keys(summary.byModel).length > 0) {
                modelsBreakdown.innerHTML = Object.entries(summary.byModel).map(([model, data]) => \`
                    <div style="display: flex; justify-content: space-between; padding: 0.5rem; background: rgba(255,255,255,0.02); border-radius: 6px; border: 1px solid var(--border-glass);">
                        <span style="color: #cbd5e1;">\${model}</span>
                        <div style="display: flex; gap: 1rem; color: var(--text-muted);">
                            <span>\${formatNumber(data.runs)} runs</span>
                            <span style="color: #34d399;">\${formatMoney(data.costUSD)}</span>
                        </div>
                    </div>
                \`).join('');
            }
        }

        // Establish SSE connection
        function connectSSE() {
            const es = new EventSource('/api/stream');
            
            es.onopen = () => {
                connStatus.innerHTML = '<span style="color: var(--success);">● Connected to Stream</span>';
            };

            es.onerror = () => {
                connStatus.innerHTML = '<span style="color: var(--error);">○ Reconnecting...</span>';
            };

            es.addEventListener('bus_event', (e) => {
                try {
                    const data = JSON.parse(e.data);
                    addEvent(data.event, data.payload);
                } catch(err){}
            });

            es.addEventListener('metrics_update', (e) => {
                try {
                    const metrics = JSON.parse(e.data);
                    updateMetrics(metrics);
                } catch(err){}
            });
        }

        connectSSE();
    </script>
</body>
</html>`;

/**
 * Spawns a standalone Agent Dashboard Web UI serving real-time SSE metrics and event streams.
 */
export function serveAgentDashboard(options: DashboardOptions = {}) {
    const port = options.port || 3000;
    const bus = options.bus || defaultGlobalBus;
    const tracker = options.costTracker || defaultCostTracker;
    const title = options.title || "GXAI Agent Dashboard";

    const server = Bun.serve({
        port,
        fetch(req: Request) {
            const url = new URL(req.url);

            // Serve standalone HTML
            if (req.method === 'GET' && url.pathname === '/') {
                return new Response(HTML_TEMPLATE(title), {
                    headers: { 'Content-Type': 'text/html; charset=utf-8' }
                });
            }

            // SSE Event Stream Endpoint
            if (req.method === 'GET' && url.pathname === '/api/stream') {
                return new Response(
                    new ReadableStream({
                        start(controller) {
                            // Helper to write SSE frames
                            const writeEvent = (event: string, data: any) => {
                                controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
                            };

                            // Push immediate initial metrics chunk
                            writeEvent('metrics_update', tracker.getSummary());

                            // Attach to global event bus
                            const unbindBus = bus.on('*', (payload, meta) => {
                                writeEvent('bus_event', { event: meta.event, payload });
                                // Periodically refresh metrics on bus activity
                                if (meta.event.includes('complete') || meta.event.includes('error')) {
                                    writeEvent('metrics_update', tracker.getSummary());
                                }
                            });

                            // Setup disconnect handler
                            req.signal.addEventListener("abort", () => {
                                unbindBus();
                                try { controller.close(); } catch { }
                            });
                        }
                    }),
                    {
                        headers: {
                            "Content-Type": "text/event-stream",
                            "Cache-Control": "no-cache",
                            "Connection": "keep-alive"
                        }
                    }
                );
            }

            return new Response("Not found", { status: 404 });
        }
    } as any);

    console.log(`[GXAI] Agent Dashboard UI running at http://localhost:${server.port}`);

    return {
        url: `http://localhost:${server.port}`,
        server
    };
}
