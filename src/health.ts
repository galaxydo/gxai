/**
 * health.ts — Agent Health Check
 *
 * Diagnostic utility that reports agent configuration,
 * memory usage, server connectivity, and runtime status.
 *
 * Usage:
 *   const report = await healthCheck(agent);
 *   console.log(report.status); // 'healthy' | 'degraded' | 'unhealthy'
 */

export interface HealthReport {
    status: 'healthy' | 'degraded' | 'unhealthy';
    timestamp: number;
    agent: {
        name: string;
        llm: string;
        hasMemory: boolean;
        hasCacheConfig: boolean;
        middlewareCount: number;
        pluginCount: number;
        serverCount: number;
    };
    runtime: {
        uptimeMs: number;
        heapUsedMB: number;
        heapTotalMB: number;
        platform: string;
    };
    servers: Array<{
        name: string;
        status: 'reachable' | 'unreachable' | 'unknown';
        latencyMs?: number;
    }>;
    checks: Array<{
        name: string;
        passed: boolean;
        message?: string;
    }>;
}

const startTime = Date.now();

/**
 * Run a health check on an agent instance.
 * The agent should have `config`, `middlewares`, and `plugins` accessible.
 */
export async function healthCheck(agent: any): Promise<HealthReport> {
    const checks: HealthReport['checks'] = [];
    const servers: HealthReport['servers'] = [];

    // Agent configuration checks
    const config = agent.config || {};
    const llm = config.llm || 'unknown';
    const hasMemory = !!config.memory;
    const hasCacheConfig = !!config.cacheConfig;
    const middlewareCount = agent.middlewares?.length ?? 0;
    const pluginCount = agent.plugins?.length ?? 0;
    const serverCount = config.servers?.length ?? 0;

    // Check: LLM is configured
    checks.push({
        name: 'llm-configured',
        passed: !!llm && llm !== 'unknown',
        message: llm !== 'unknown' ? `Using ${llm}` : 'No LLM configured',
    });

    // Check: Input/Output formats defined
    checks.push({
        name: 'schema-defined',
        passed: !!config.inputFormat && !!config.outputFormat,
        message: config.inputFormat ? 'Schemas configured' : 'Missing input/output schemas',
    });

    // Check: System prompt exists
    checks.push({
        name: 'system-prompt',
        passed: !!config.systemPrompt && config.systemPrompt.length > 10,
        message: config.systemPrompt ? `${config.systemPrompt.length} chars` : 'No system prompt',
    });

    // Check: Memory configuration
    if (hasMemory) {
        const mem = config.memory;
        checks.push({
            name: 'memory-health',
            passed: true,
            message: `${mem.turnCount ?? 0} turns, ${mem.messageCount ?? 0} messages`,
        });
    }

    // Check: Cost budget
    if (config.maxCostUSD) {
        checks.push({
            name: 'cost-budget',
            passed: true,
            message: `Max $${config.maxCostUSD}/run`,
        });
    }

    // Server connectivity checks
    if (config.servers?.length) {
        for (const server of config.servers) {
            const serverName = server.name || server.url || 'unnamed';
            try {
                const start = Date.now();
                // Try a lightweight connectivity test
                if (server.url) {
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 5000);
                    try {
                        await fetch(server.url, {
                            method: 'HEAD',
                            signal: controller.signal,
                        });
                        clearTimeout(timeout);
                        servers.push({
                            name: serverName,
                            status: 'reachable',
                            latencyMs: Date.now() - start,
                        });
                    } catch {
                        clearTimeout(timeout);
                        servers.push({ name: serverName, status: 'unreachable' });
                    }
                } else {
                    servers.push({ name: serverName, status: 'unknown' });
                }
            } catch {
                servers.push({ name: serverName, status: 'unreachable' });
            }
        }
    }

    // Runtime metrics
    let heapUsedMB = 0;
    let heapTotalMB = 0;
    try {
        if (typeof process !== 'undefined' && process.memoryUsage) {
            const mem = process.memoryUsage();
            heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100;
            heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024 * 100) / 100;
        }
    } catch { /* browser environment */ }

    // Determine overall status
    const allPassed = checks.every(c => c.passed);
    const anyServerDown = servers.some(s => s.status === 'unreachable');
    let status: HealthReport['status'] = 'healthy';
    if (!allPassed || anyServerDown) status = 'degraded';
    if (!checks.find(c => c.name === 'llm-configured')?.passed) status = 'unhealthy';

    return {
        status,
        timestamp: Date.now(),
        agent: {
            name: config.name || agent.constructor?.name || 'Agent',
            llm,
            hasMemory,
            hasCacheConfig,
            middlewareCount,
            pluginCount,
            serverCount,
        },
        runtime: {
            uptimeMs: Date.now() - startTime,
            heapUsedMB,
            heapTotalMB,
            platform: typeof process !== 'undefined' ? process.platform : 'browser',
        },
        servers,
        checks,
    };
}

/** Format a health report as a human-readable string */
export function formatHealthReport(report: HealthReport): string {
    const statusEmoji = report.status === 'healthy' ? '✅' : report.status === 'degraded' ? '⚠️' : '❌';
    const lines = [
        `${statusEmoji} Agent Health: ${report.status.toUpperCase()}`,
        `Agent: ${report.agent.name} (${report.agent.llm})`,
        `Memory: ${report.agent.hasMemory ? 'Yes' : 'No'} | Cache: ${report.agent.hasCacheConfig ? 'Yes' : 'No'}`,
        `Middleware: ${report.agent.middlewareCount} | Plugins: ${report.agent.pluginCount} | Servers: ${report.agent.serverCount}`,
        `Uptime: ${Math.round(report.runtime.uptimeMs / 1000)}s | Heap: ${report.runtime.heapUsedMB}/${report.runtime.heapTotalMB}MB`,
        '',
        'Checks:',
        ...report.checks.map(c => `  ${c.passed ? '✓' : '✗'} ${c.name}: ${c.message || ''}`),
    ];

    if (report.servers.length) {
        lines.push('', 'Servers:');
        for (const s of report.servers) {
            lines.push(`  ${s.status === 'reachable' ? '✓' : '✗'} ${s.name}: ${s.status}${s.latencyMs ? ` (${s.latencyMs}ms)` : ''}`);
        }
    }

    return lines.join('\n');
}
