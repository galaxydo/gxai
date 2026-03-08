/**
 * health.ts — CLI health check command
 *
 * Runs a standalone health check without requiring an agent instance.
 * Reports runtime environment, dependency status, and configuration.
 */

export async function handleHealth() {
    const lines: string[] = [];
    const ok = '✓';
    const fail = '✗';

    lines.push('🧠 GXAI Health Check\n');

    // 1. Runtime
    const runtime = typeof Bun !== 'undefined' ? `Bun ${Bun.version}` : `Node ${process.version}`;
    lines.push(`${ok} Runtime: ${runtime}`);
    lines.push(`${ok} Platform: ${process.platform} (${process.arch})`);

    // 2. Memory
    const mem = process.memoryUsage();
    const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(1);
    const totalMB = (mem.heapTotal / 1024 / 1024).toFixed(1);
    lines.push(`${ok} Memory: ${heapMB}MB / ${totalMB}MB heap`);

    // 3. Check core dependencies
    const deps = ['melina', 'zod', '@anthropic-ai/sdk', '@google/genai'];
    for (const dep of deps) {
        try {
            require.resolve(dep);
            lines.push(`${ok} ${dep}: installed`);
        } catch {
            lines.push(`${fail} ${dep}: not found`);
        }
    }

    // 4. Check env vars
    const envVars = [
        ['ANTHROPIC_API_KEY', 'Anthropic'],
        ['GOOGLE_API_KEY', 'Google AI'],
        ['OPENAI_API_KEY', 'OpenAI'],
    ] as const;

    lines.push('');
    lines.push('API Keys:');
    for (const [key, label] of envVars) {
        const val = process.env[key];
        if (val) {
            lines.push(`  ${ok} ${label}: ${val.slice(0, 8)}...${val.slice(-4)}`);
        } else {
            lines.push(`  - ${label}: not set`);
        }
    }

    // 5. Analytics queue
    try {
        const { existsSync, statSync } = require('fs');
        const { join } = require('path');
        const queuePath = join(process.env.HOME || process.env.USERPROFILE || '.', '.gxai', 'analytics.jsonl');
        if (existsSync(queuePath)) {
            const size = statSync(queuePath).size;
            lines.push(`\n${ok} Analytics queue: ${(size / 1024).toFixed(1)}KB`);
        } else {
            lines.push(`\n- Analytics queue: empty`);
        }
    } catch {
        lines.push(`\n- Analytics queue: unable to check`);
    }

    lines.push(`\n✅ Health check complete`);
    console.log(lines.join('\n'));
}
