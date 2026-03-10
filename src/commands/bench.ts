/**
 * gx --bench — Multi-model benchmark comparison
 * 
 * Runs the same prompt across all configured providers in parallel.
 * Shows response time, token usage, cost, and truncated output.
 */

import { callLLM, lastTokenUsage } from '../inference';
import { calculateCost } from '../pricing';
import type { TokenUsage } from '../types';

const C = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    bold: '\x1b[1m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    magenta: '\x1b[35m',
    gray: '\x1b[90m',
};

interface BenchResult {
    model: string;
    response: string;
    tokens: TokenUsage | null;
    costUSD: number;
    durationMs: number;
    error?: string;
    reasoning?: string;
}

const BENCH_MODELS: Array<{ key: string; model: string; envKey: string }> = [
    { key: 'gpt-4o-mini', model: 'gpt-4o-mini', envKey: 'OPENAI_API_KEY' },
    { key: 'gpt-4o', model: 'gpt-4o', envKey: 'OPENAI_API_KEY' },
    { key: 'claude-sonnet', model: 'claude-sonnet-4-20250514', envKey: 'ANTHROPIC_API_KEY' },
    { key: 'claude-haiku', model: 'claude-3-5-haiku-20241022', envKey: 'ANTHROPIC_API_KEY' },
    { key: 'gemini-flash', model: 'gemini-2.0-flash', envKey: 'GEMINI_API_KEY' },
    { key: 'gemini-2.5-flash', model: 'gemini-2.5-flash-preview-05-20', envKey: 'GEMINI_API_KEY' },
    { key: 'deepseek', model: 'deepseek-chat', envKey: 'DEEPSEEK_API_KEY' },
];

export async function handleBench(prompt?: string) {
    const userPrompt = prompt || 'Explain quantum entanglement in 2 sentences.';

    // Filter to only models with API keys configured
    const available = BENCH_MODELS.filter(m => {
        const key = process.env[m.envKey];
        if (m.envKey === 'GEMINI_API_KEY') return key || process.env.GOOGLE_API_KEY;
        return !!key;
    });

    if (available.length === 0) {
        console.log(`\n${C.yellow}⚠ No API keys configured. Set at least one:${C.reset}`);
        console.log(`  OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, DEEPSEEK_API_KEY\n`);
        process.exit(1);
    }

    console.log(`\n${C.bold}${C.cyan}⚡ GXAI Benchmark${C.reset}`);
    console.log(`${C.dim}Prompt: "${userPrompt}"${C.reset}`);
    console.log(`${C.dim}Models: ${available.length} configured (${available.map(m => m.key).join(', ')})${C.reset}`);
    console.log(`${C.dim}Running in parallel...${C.reset}\n`);

    const startAll = Date.now();

    // Run all models in parallel
    const promises = available.map(async ({ key, model }): Promise<BenchResult> => {
        const start = Date.now();
        try {
            const response = await callLLM(model, [{ role: 'user', content: userPrompt }]);
            const duration = Date.now() - start;
            const tokens = lastTokenUsage ? { ...lastTokenUsage } : null;
            const cost = tokens ? calculateCost(model, tokens) : null;
            return {
                model: key,
                response,
                tokens,
                costUSD: cost?.totalCost || 0,
                durationMs: duration,
                reasoning: tokens?.reasoningContent,
            };
        } catch (err: any) {
            return {
                model: key,
                response: '',
                tokens: null,
                costUSD: 0,
                durationMs: Date.now() - start,
                error: err.message,
            };
        }
    });

    const results = await Promise.all(promises);
    const totalMs = Date.now() - startAll;

    // Sort by speed
    const sorted = results.sort((a, b) => {
        if (a.error && !b.error) return 1;
        if (!a.error && b.error) return -1;
        return a.durationMs - b.durationMs;
    });

    // Display results
    const pad = (s: string, n: number) => s.padEnd(n);
    const rpad = (s: string, n: number) => s.padStart(n);

    console.log(`${C.bold}${pad('Model', 18)} ${rpad('Time', 8)} ${rpad('In', 6)} ${rpad('Out', 6)} ${rpad('Cost', 10)} Response${C.reset}`);
    console.log(`${'─'.repeat(90)}`);

    for (let i = 0; i < sorted.length; i++) {
        const r = sorted[i]!;
        const rank = i === 0 && !r.error ? `${C.green}🏆` : C.reset;

        if (r.error) {
            console.log(`${C.red}${pad(r.model, 18)} ${rpad(r.durationMs + 'ms', 8)} ${C.yellow}${r.error.slice(0, 50)}${C.reset}`);
            continue;
        }

        const time = r.durationMs < 1000 ? `${r.durationMs}ms` : `${(r.durationMs / 1000).toFixed(1)}s`;
        const inTok = r.tokens ? String(r.tokens.inputTokens) : '-';
        const outTok = r.tokens ? String(r.tokens.outputTokens) : '-';
        const cost = r.costUSD > 0 ? `$${r.costUSD.toFixed(6)}` : '-';
        const preview = r.response
            .replace(/\n/g, ' ')
            .slice(0, 60)
            + (r.response.length > 60 ? '…' : '');

        console.log(`${rank}${pad(r.model, 18)} ${rpad(time, 8)} ${rpad(inTok, 6)} ${rpad(outTok, 6)} ${rpad(cost, 10)} ${C.dim}${preview}${C.reset}`);
    }

    // Summary
    const successful = sorted.filter(r => !r.error);
    const fastest = successful[0];
    const cheapest = successful.sort((a, b) => a.costUSD - b.costUSD)[0];

    console.log(`\n${'─'.repeat(90)}`);
    console.log(`${C.dim}Total wall time: ${totalMs}ms (parallel)${C.reset}`);
    if (fastest) console.log(`${C.green}⚡ Fastest: ${fastest.model} (${fastest.durationMs}ms)${C.reset}`);
    if (cheapest && cheapest.costUSD > 0) console.log(`${C.green}💰 Cheapest: ${cheapest.model} ($${cheapest.costUSD.toFixed(6)})${C.reset}`);

    // Show reasoning if any model produced it
    const withReasoning = sorted.filter(r => r.reasoning);
    if (withReasoning.length > 0) {
        console.log(`\n${C.bold}💭 Reasoning models:${C.reset}`);
        for (const r of withReasoning) {
            const preview = r.reasoning!.replace(/\n/g, ' ').slice(0, 100) + (r.reasoning!.length > 100 ? '…' : '');
            console.log(`  ${C.yellow}${r.model}${C.reset}: ${C.dim}${preview}${C.reset}`);
        }
    }

    console.log();
}
