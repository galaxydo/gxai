/**
 * gx --chat — Interactive LLM REPL
 * 
 * Features:
 * - Multi-provider support (--model flag)
 * - Streaming responses with reasoning visibility
 * - Conversation memory (multi-turn)
 * - Token usage tracking
 */

import { callLLM, lastTokenUsage } from '../inference';
import type { StreamingCallback, LLMMessage } from '../types';
import { createInterface } from 'readline';

const MODELS: Record<string, string> = {
    'gpt': 'gpt-4o-mini',
    'gpt4': 'gpt-4o',
    'o4': 'o4-mini',
    'claude': 'claude-sonnet-4-20250514',
    'haiku': 'claude-3-5-haiku-20241022',
    'deepseek': 'deepseek-chat',
    'r1': 'deepseek-reasoner',
    'gemini': 'gemini-2.5-flash-preview-05-20',
    'gemini-pro': 'gemini-2.5-pro-preview-05-06',
    'flash': 'gemini-2.0-flash',
};

const COLORS = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    bold: '\x1b[1m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    magenta: '\x1b[35m',
    gray: '\x1b[90m',
};

export async function handleChat(model?: string) {
    const resolvedModel = model ? (MODELS[model] || model) : 'gpt-4o-mini';

    console.log(`\n${COLORS.bold}${COLORS.cyan}🧠 GXAI Chat${COLORS.reset}`);
    console.log(`${COLORS.dim}Model: ${COLORS.green}${resolvedModel}${COLORS.reset}`);
    console.log(`${COLORS.dim}Type ${COLORS.yellow}/help${COLORS.dim} for commands, ${COLORS.yellow}/quit${COLORS.dim} to exit${COLORS.reset}\n`);

    const messages: LLMMessage[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: `${COLORS.cyan}> ${COLORS.reset}`,
    });

    const showHelp = () => {
        console.log(`
${COLORS.bold}Commands:${COLORS.reset}
  ${COLORS.yellow}/model <name>${COLORS.reset}   Switch model (${Object.keys(MODELS).join(', ')})
  ${COLORS.yellow}/models${COLORS.reset}         List available model shortcuts
  ${COLORS.yellow}/clear${COLORS.reset}          Clear conversation history
  ${COLORS.yellow}/tokens${COLORS.reset}         Show token usage stats
  ${COLORS.yellow}/system <msg>${COLORS.reset}   Set system prompt
  ${COLORS.yellow}/quit${COLORS.reset}           Exit
`);
    };

    let currentModel = resolvedModel;
    let systemPrompt: string | null = null;

    rl.prompt();

    rl.on('line', async (input) => {
        const trimmed = input.trim();
        if (!trimmed) { rl.prompt(); return; }

        // Commands
        if (trimmed === '/quit' || trimmed === '/exit' || trimmed === '/q') {
            console.log(`\n${COLORS.dim}Tokens used: ${totalInputTokens} in / ${totalOutputTokens} out${COLORS.reset}`);
            rl.close();
            process.exit(0);
        }

        if (trimmed === '/help' || trimmed === '/h') {
            showHelp();
            rl.prompt();
            return;
        }

        if (trimmed === '/models') {
            console.log(`\n${COLORS.bold}Model shortcuts:${COLORS.reset}`);
            for (const [k, v] of Object.entries(MODELS)) {
                const active = v === currentModel ? ` ${COLORS.green}← active${COLORS.reset}` : '';
                console.log(`  ${COLORS.yellow}${k.padEnd(12)}${COLORS.reset} → ${v}${active}`);
            }
            console.log();
            rl.prompt();
            return;
        }

        if (trimmed.startsWith('/model ')) {
            const name = trimmed.slice(7).trim();
            currentModel = MODELS[name] || name;
            console.log(`${COLORS.green}✓ Switched to ${currentModel}${COLORS.reset}\n`);
            rl.prompt();
            return;
        }

        if (trimmed === '/clear') {
            messages.length = 0;
            console.log(`${COLORS.green}✓ Conversation cleared${COLORS.reset}\n`);
            rl.prompt();
            return;
        }

        if (trimmed === '/tokens') {
            console.log(`\n${COLORS.bold}Token Usage:${COLORS.reset}`);
            console.log(`  Input:  ${totalInputTokens.toLocaleString()}`);
            console.log(`  Output: ${totalOutputTokens.toLocaleString()}`);
            console.log(`  Total:  ${(totalInputTokens + totalOutputTokens).toLocaleString()}\n`);
            rl.prompt();
            return;
        }

        if (trimmed.startsWith('/system ')) {
            systemPrompt = trimmed.slice(8).trim();
            console.log(`${COLORS.green}✓ System prompt set${COLORS.reset}\n`);
            rl.prompt();
            return;
        }

        // Regular message
        messages.push({ role: 'user', content: trimmed });

        const allMessages: LLMMessage[] = [];
        if (systemPrompt) {
            allMessages.push({ role: 'system', content: systemPrompt });
        }
        allMessages.push(...messages);

        process.stdout.write(`\n${COLORS.magenta}`);
        let hasReasoning = false;

        try {
            const streamingCallback: StreamingCallback = (update) => {
                if (update.field === '_reasoning') {
                    if (!hasReasoning) {
                        process.stdout.write(`${COLORS.dim}${COLORS.gray}💭 `);
                        hasReasoning = true;
                    }
                    process.stdout.write(update.value);
                } else {
                    if (hasReasoning) {
                        process.stdout.write(`${COLORS.reset}\n\n${COLORS.magenta}`);
                        hasReasoning = false;
                    }
                    process.stdout.write(update.value);
                }
            };

            const result = await callLLM(currentModel, allMessages, { streaming: streamingCallback });

            // If no streaming happened (non-streaming path), print result
            if (!hasReasoning && result && !process.stdout.writableLength) {
                process.stdout.write(result);
            }

            process.stdout.write(`${COLORS.reset}\n`);

            messages.push({ role: 'assistant', content: result });

            if (lastTokenUsage) {
                totalInputTokens += lastTokenUsage.inputTokens;
                totalOutputTokens += lastTokenUsage.outputTokens;
                process.stdout.write(`${COLORS.dim}[${lastTokenUsage.inputTokens}→${lastTokenUsage.outputTokens} tokens]${COLORS.reset}\n`);
            }
        } catch (err: any) {
            process.stdout.write(`${COLORS.reset}\n`);
            console.log(`${COLORS.yellow}⚠ Error: ${err.message}${COLORS.reset}`);
        }

        console.log();
        rl.prompt();
    });

    rl.on('close', () => {
        process.exit(0);
    });
}
