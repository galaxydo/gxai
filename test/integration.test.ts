/**
 * Integration Tests — End-to-end flows hitting real LLM APIs.
 *
 * These tests are gated behind environment variables:
 *   OPENAI_API_KEY     → OpenAI tests
 *   GEMINI_API_KEY     → Gemini tests
 *   ANTHROPIC_API_KEY  → Anthropic tests
 *   DEEPSEEK_API_KEY   → DeepSeek tests
 *
 * If no API key is set, the test gracefully skips with a console warning.
 * Run: OPENAI_API_KEY=sk-... bun test test/integration.test.ts
 */
import { test, expect, describe, afterEach } from 'bun:test';
import { z } from 'zod';
import { Agent } from '../src/agent';
import { callLLM, lastTokenUsage, callLLMWithFallback } from '../src/inference';
import { LoopAgent } from '../src/loop';
import type { StreamingUpdate, ProgressUpdate } from '../src/types';
import * as fs from 'fs';
import * as path from 'path';

// ─── Helpers ────────────────────────────────────────────

const hasKey = (name: string) => !!process.env[name];
const hasOpenAI = () => hasKey('OPENAI_API_KEY');
const hasGemini = () => hasKey('GEMINI_API_KEY') || hasKey('GOOGLE_API_KEY');
const hasAnthropic = () => hasKey('ANTHROPIC_API_KEY');
const hasDeepSeek = () => hasKey('DEEPSEEK_API_KEY');
const hasAnyKey = () => hasOpenAI() || hasGemini() || hasAnthropic() || hasDeepSeek();

function skipIfNoKey(keyName: string, provider: string): boolean {
    if (!hasKey(keyName)) {
        console.warn(`⏭️  Skipping ${provider} integration test (${keyName} not set)`);
        return true;
    }
    return false;
}

// ─── 1. callLLM — Direct Inference ──────────────────────

describe('Integration: callLLM', () => {

    test('OpenAI — non-streaming', async () => {
        if (skipIfNoKey('OPENAI_API_KEY', 'OpenAI')) return;

        const result = await callLLM(
            'gpt-4o-mini',
            [{ role: 'user', content: 'Reply with exactly: INTEGRATION_OK' }],
            { temperature: 0, maxTokens: 50 },
        );

        expect(result).toContain('INTEGRATION_OK');
        expect(lastTokenUsage).not.toBeNull();
        expect(lastTokenUsage!.inputTokens).toBeGreaterThan(0);
        expect(lastTokenUsage!.outputTokens).toBeGreaterThan(0);
        console.log(`✅ OpenAI non-streaming — tokens: ${lastTokenUsage!.totalTokens}`);
    }, { timeout: 30_000 });

    test('OpenAI — streaming with field extraction', async () => {
        if (skipIfNoKey('OPENAI_API_KEY', 'OpenAI')) return;

        const updates: StreamingUpdate[] = [];
        const result = await callLLM(
            'gpt-4o-mini',
            [{ role: 'user', content: 'Reply with: <answer>42</answer>' }],
            { temperature: 0, maxTokens: 100 },
            null,
            (update) => updates.push(update),
        );

        expect(result).toContain('42');
        expect(updates.length).toBeGreaterThan(0);
        expect(updates.some(u => u.field === 'answer')).toBe(true);
        expect(lastTokenUsage).not.toBeNull();
        console.log(`✅ OpenAI streaming — ${updates.length} chunks, tokens: ${lastTokenUsage!.totalTokens}`);
    }, { timeout: 30_000 });

    test('Gemini — non-streaming with retry', async () => {
        if (skipIfNoKey('GEMINI_API_KEY', 'Gemini') && skipIfNoKey('GOOGLE_API_KEY', 'Gemini')) return;

        const result = await callLLM(
            'gemini-2.0-flash',
            [{ role: 'user', content: 'Reply with exactly: GEMINI_OK' }],
            { temperature: 0, maxTokens: 50 },
        );

        expect(result).toContain('GEMINI_OK');
        expect(lastTokenUsage).not.toBeNull();
        console.log(`✅ Gemini non-streaming — tokens: ${lastTokenUsage!.totalTokens}`);
    }, { timeout: 30_000 });

    test('Anthropic — non-streaming', async () => {
        if (skipIfNoKey('ANTHROPIC_API_KEY', 'Anthropic')) return;

        const result = await callLLM(
            'claude-3-5-sonnet-20241022',
            [{ role: 'user', content: 'Reply with exactly: CLAUDE_OK' }],
            { temperature: 0, maxTokens: 50 },
        );

        expect(result).toContain('CLAUDE_OK');
        expect(lastTokenUsage).not.toBeNull();
        console.log(`✅ Anthropic non-streaming — tokens: ${lastTokenUsage!.totalTokens}`);
    }, { timeout: 30_000 });

    test('Anthropic — streaming', async () => {
        if (skipIfNoKey('ANTHROPIC_API_KEY', 'Anthropic')) return;

        const updates: StreamingUpdate[] = [];
        const result = await callLLM(
            'claude-3-5-sonnet-20241022',
            [{ role: 'user', content: 'Reply with: <result>hello</result>' }],
            { temperature: 0, maxTokens: 100 },
            null,
            (update) => updates.push(update),
        );

        expect(result).toContain('hello');
        expect(updates.length).toBeGreaterThan(0);
        expect(lastTokenUsage).not.toBeNull();
        console.log(`✅ Anthropic streaming — ${updates.length} chunks, tokens: ${lastTokenUsage!.totalTokens}`);
    }, { timeout: 30_000 });

    test('DeepSeek — non-streaming', async () => {
        if (skipIfNoKey('DEEPSEEK_API_KEY', 'DeepSeek')) return;

        const result = await callLLM(
            'deepseek-chat',
            [{ role: 'user', content: 'Reply with exactly: DEEPSEEK_OK' }],
            { temperature: 0, maxTokens: 50 },
        );

        expect(result).toContain('DEEPSEEK_OK');
        expect(lastTokenUsage).not.toBeNull();
        console.log(`✅ DeepSeek non-streaming — tokens: ${lastTokenUsage!.totalTokens}`);
    }, { timeout: 30_000 });

    test('OpenAI o4-mini — reasoning model non-streaming', async () => {
        if (skipIfNoKey('OPENAI_API_KEY', 'OpenAI o4-mini')) return;

        const result = await callLLM(
            'o4-mini',
            [{ role: 'user', content: 'What is 7 * 8? Reply with just the number.' }],
            { maxTokens: 1000 },
        );

        expect(result).toContain('56');
        expect(lastTokenUsage).not.toBeNull();
        expect(lastTokenUsage!.inputTokens).toBeGreaterThan(0);
        console.log(`✅ o4-mini non-streaming — tokens: ${lastTokenUsage!.totalTokens}`);
    }, { timeout: 60_000 });

    test('OpenAI o4-mini — streaming with field extraction', async () => {
        if (skipIfNoKey('OPENAI_API_KEY', 'OpenAI o4-mini streaming')) return;

        const updates: StreamingUpdate[] = [];
        const result = await callLLM(
            'o4-mini',
            [{ role: 'user', content: 'Reply with: <answer>reasoning_works</answer>' }],
            { maxTokens: 1000 },
            null,
            (update) => updates.push(update),
        );

        expect(result).toContain('reasoning_works');
        expect(updates.length).toBeGreaterThan(0);
        console.log(`✅ o4-mini streaming — ${updates.length} chunks`);
    }, { timeout: 60_000 });
});

// ─── 2. callLLMWithFallback ─────────────────────────────

describe('Integration: callLLMWithFallback', () => {

    test('fallback chain across providers', async () => {
        // Build a fallback chain from available providers
        const providers: string[] = [];
        if (hasOpenAI()) providers.push('gpt-4o-mini');
        if (hasGemini()) providers.push('gemini-2.0-flash');
        if (hasAnthropic()) providers.push('claude-3-5-sonnet-20241022');
        if (hasDeepSeek()) providers.push('deepseek-chat');

        if (providers.length < 1) {
            console.warn('⏭️  Skipping fallback test (no API keys set)');
            return;
        }

        const fallbackLog: string[] = [];
        const result = await callLLMWithFallback(
            {
                providers,
                onFallback: (failed, error, next) => {
                    fallbackLog.push(`${failed} → ${next}: ${error}`);
                },
            },
            [{ role: 'user', content: 'Reply with exactly: FALLBACK_OK' }],
            { temperature: 0, maxTokens: 50 },
        );

        expect(result).toContain('FALLBACK_OK');
        // Should succeed on first provider (no fallbacks triggered)
        expect(fallbackLog).toHaveLength(0);
        console.log(`✅ Fallback chain — succeeded with ${providers[0]}, ${providers.length} providers configured`);
    }, { timeout: 30_000 });
});

// ─── 3. Agent.run() — Structured I/O ───────────────────

describe('Integration: Agent.run()', () => {

    test('structured output parsing with Zod schema', async () => {
        if (!hasAnyKey()) {
            console.warn('⏭️  Skipping Agent.run() test (no API keys set)');
            return;
        }

        // Pick the first available provider
        const llm = hasOpenAI() ? 'gpt-4o-mini'
            : hasGemini() ? 'gemini-2.0-flash'
                : hasAnthropic() ? 'claude-3-5-sonnet-20241022'
                    : 'deepseek-chat';

        const agent = new Agent({
            llm: llm as any,
            inputFormat: z.object({
                question: z.string(),
            }),
            outputFormat: z.object({
                answer: z.string().describe('A concise answer to the question'),
                confidence: z.number().describe('Confidence score from 0 to 1'),
                reasoning: z.string().describe('Brief explanation of the reasoning'),
            }),
            temperature: 0,
        });

        const progressUpdates: ProgressUpdate[] = [];
        const result = await agent.run(
            { question: 'What is 2 + 2?' },
            (update) => progressUpdates.push(update),
        );

        expect(result.answer).toBeDefined();
        expect(typeof result.answer).toBe('string');
        expect(result.answer.length).toBeGreaterThan(0);
        expect(result.confidence).toBeTypeOf('number');
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(1);
        expect(result.reasoning).toBeTypeOf('string');
        console.log(`✅ Agent.run() — answer: "${result.answer}", confidence: ${result.confidence}`);
    }, { timeout: 60_000 });

    test('streaming output with field-level callbacks', async () => {
        if (!hasAnyKey()) {
            console.warn('⏭️  Skipping Agent streaming test (no API keys set)');
            return;
        }

        const llm = hasOpenAI() ? 'gpt-4o-mini'
            : hasGemini() ? 'gemini-2.0-flash'
                : hasAnthropic() ? 'claude-3-5-sonnet-20241022'
                    : 'deepseek-chat';

        const agent = new Agent({
            llm: llm as any,
            inputFormat: z.object({ topic: z.string() }),
            outputFormat: z.object({
                title: z.string().describe('A short title'),
                summary: z.string().describe('A one-sentence summary'),
            }),
            temperature: 0.3,
        });

        const streamedFields: Record<string, string> = {};
        const result = await agent.run(
            { topic: 'quantum computing' },
            (update: any) => {
                if (update.stage === 'streaming') {
                    streamedFields[update.field] = (streamedFields[update.field] || '') + update.value;
                }
            },
        );

        expect(result.title).toBeTypeOf('string');
        expect(result.title.length).toBeGreaterThan(0);
        expect(result.summary).toBeTypeOf('string');
        expect(result.summary.length).toBeGreaterThan(0);
        // Streaming fields should have been captured
        expect(Object.keys(streamedFields).length).toBeGreaterThan(0);
        console.log(`✅ Agent streaming — title: "${result.title}", streamed fields: ${Object.keys(streamedFields).join(', ')}`);
    }, { timeout: 60_000 });

    test('boolean and numeric schema fields', async () => {
        if (!hasAnyKey()) {
            console.warn('⏭️  Skipping boolean/numeric schema test (no API keys set)');
            return;
        }

        const llm = hasOpenAI() ? 'gpt-4o-mini'
            : hasGemini() ? 'gemini-2.0-flash'
                : hasAnthropic() ? 'claude-3-5-sonnet-20241022'
                    : 'deepseek-chat';

        const agent = new Agent({
            llm: llm as any,
            inputFormat: z.object({ statement: z.string() }),
            outputFormat: z.object({
                isTrue: z.boolean().describe('Whether the statement is factually true'),
                certaintyPercent: z.number().describe('How certain you are, 0-100'),
            }),
            temperature: 0,
        });

        const result = await agent.run({ statement: 'The earth orbits the sun.' });

        expect(result.isTrue).toBe(true);
        expect(result.certaintyPercent).toBeTypeOf('number');
        expect(result.certaintyPercent).toBeGreaterThan(50);
        console.log(`✅ Boolean/numeric schema — isTrue: ${result.isTrue}, certainty: ${result.certaintyPercent}%`);
    }, { timeout: 60_000 });
});

// ─── 4. Agent with middleware ───────────────────────────

describe('Integration: Agent middleware', () => {

    test('before/after middleware fires on real LLM call', async () => {
        if (!hasAnyKey()) {
            console.warn('⏭️  Skipping middleware test (no API keys set)');
            return;
        }

        const llm = hasOpenAI() ? 'gpt-4o-mini'
            : hasGemini() ? 'gemini-2.0-flash'
                : hasAnthropic() ? 'claude-3-5-sonnet-20241022'
                    : 'deepseek-chat';

        const phases: string[] = [];

        const agent = new Agent({
            name: 'middleware-test',
            llm: llm as any,
            inputFormat: z.object({ text: z.string() }),
            outputFormat: z.object({ echo: z.string().describe('Echo the input text back') }),
            temperature: 0,
        });

        agent.use(async (ctx) => {
            phases.push(ctx.phase);
            if (ctx.phase === 'after') {
                expect(ctx.output).toBeDefined();
                expect(ctx.durationMs).toBeGreaterThan(0);
            }
        });

        const result = await agent.run({ text: 'hello' });

        expect(phases).toContain('before');
        expect(phases).toContain('after');
        expect(result.echo).toBeTypeOf('string');
        console.log(`✅ Middleware — phases fired: ${phases.join(', ')}, echo: "${result.echo}"`);
    }, { timeout: 60_000 });
});

// ─── 5. Agent.estimateCost ──────────────────────────────

describe('Integration: cost estimation', () => {

    test('estimateCost returns reasonable values', async () => {
        if (!hasAnyKey()) {
            console.warn('⏭️  Skipping cost estimation test');
            return;
        }

        const llm = hasOpenAI() ? 'gpt-4o-mini'
            : hasGemini() ? 'gemini-2.0-flash'
                : hasAnthropic() ? 'claude-3-5-sonnet-20241022'
                    : 'deepseek-chat';

        const agent = new Agent({
            llm: llm as any,
            inputFormat: z.object({ text: z.string() }),
            outputFormat: z.object({ reply: z.string() }),
        });

        const estimate = agent.estimateCost({ text: 'Hello world' });

        expect(estimate.totalCost).toBeGreaterThanOrEqual(0);
        expect(estimate.inputCost).toBeGreaterThanOrEqual(0);
        expect(estimate.outputCost).toBeGreaterThanOrEqual(0);
        console.log(`✅ Cost estimate — $${estimate.totalCost.toFixed(6)} (input: $${estimate.inputCost.toFixed(6)}, output: $${estimate.outputCost.toFixed(6)})`);
    });
});

// ─── 6. LoopAgent — Real LLM + Tool Execution ──────────

describe('Integration: LoopAgent', () => {
    const testDir = path.join(process.cwd(), 'test-data-integration');

    afterEach(() => {
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    test('real LLM writes a file and validates outcome', async () => {
        if (!hasAnyKey()) {
            console.warn('⏭️  Skipping LoopAgent integration test (no API keys set)');
            return;
        }

        const llm = hasOpenAI() ? 'gpt-4o-mini'
            : hasGemini() ? 'gemini-2.0-flash'
                : hasAnthropic() ? 'claude-3-5-sonnet-20241022'
                    : 'deepseek-chat';

        const targetFile = path.join(testDir, 'greeting.txt');

        const agent = new LoopAgent({
            llm,
            maxIterations: 3,
            cwd: process.cwd(),
            outcomes: [
                {
                    description: 'greeting.txt exists with content "Hello, World!"',
                    validate: async () => {
                        if (!fs.existsSync(targetFile)) {
                            return { met: false, reason: 'File does not exist' };
                        }
                        const content = fs.readFileSync(targetFile, 'utf-8');
                        return {
                            met: content.includes('Hello'),
                            reason: content.includes('Hello') ? 'File contains greeting' : `File content: "${content}"`,
                        };
                    },
                },
            ],
        });

        const events: any[] = [];
        const result = await agent.execute(
            `Write a file at ${testDir}/greeting.txt with the content "Hello, World!"`,
            (e) => events.push(e),
        );

        expect(result.success).toBe(true);
        expect(result.iterations).toBeGreaterThanOrEqual(1);
        expect(result.iterations).toBeLessThanOrEqual(3);
        expect(fs.existsSync(targetFile)).toBe(true);
        expect(events.some(e => e.type === 'tool_start' && e.tool === 'write_file')).toBe(true);
        expect(events.some(e => e.type === 'complete')).toBe(true);
        console.log(`✅ LoopAgent integration — completed in ${result.iterations} iteration(s), ${result.elapsedMs}ms`);
    }, { timeout: 120_000 });
});

// ─── 7. Agent.runStream() — Async Generator ────────────

describe('Integration: Agent.runStream()', () => {

    test('yields progress chunks then final result', async () => {
        if (!hasAnyKey()) {
            console.warn('⏭️  Skipping runStream test (no API keys set)');
            return;
        }

        const llm = hasOpenAI() ? 'gpt-4o-mini'
            : hasGemini() ? 'gemini-2.0-flash'
                : hasAnthropic() ? 'claude-3-5-sonnet-20241022'
                    : 'deepseek-chat';

        const agent = new Agent({
            llm: llm as any,
            inputFormat: z.object({ prompt: z.string() }),
            outputFormat: z.object({
                response: z.string().describe('Your response'),
            }),
            temperature: 0,
        });

        const chunks: any[] = [];
        let finalResult: any = null;

        for await (const chunk of agent.runStream({ prompt: 'Say hello' })) {
            chunks.push(chunk);
            if (chunk.done) {
                finalResult = chunk;
            }
        }

        expect(chunks.length).toBeGreaterThan(0);
        expect(finalResult).not.toBeNull();
        expect(finalResult.done).toBe(true);
        expect(finalResult.output?.response).toBeTypeOf('string');
        console.log(`✅ runStream — ${chunks.length} chunks, final: "${finalResult.output?.response?.substring(0, 50)}..."`);
    }, { timeout: 60_000 });
});

// ─── 8. Token usage tracking ────────────────────────────

describe('Integration: token usage', () => {

    test('lastTokenUsage populated after callLLM', async () => {
        if (!hasAnyKey()) {
            console.warn('⏭️  Skipping token usage test (no API keys set)');
            return;
        }

        const llm = hasOpenAI() ? 'gpt-4o-mini'
            : hasGemini() ? 'gemini-2.0-flash'
                : hasAnthropic() ? 'claude-3-5-sonnet-20241022'
                    : 'deepseek-chat';

        await callLLM(
            llm,
            [{ role: 'user', content: 'Say "test"' }],
            { temperature: 0, maxTokens: 10 },
        );

        expect(lastTokenUsage).not.toBeNull();
        expect(lastTokenUsage!.inputTokens).toBeGreaterThan(0);
        expect(lastTokenUsage!.outputTokens).toBeGreaterThan(0);
        expect(lastTokenUsage!.totalTokens).toBe(
            lastTokenUsage!.inputTokens + lastTokenUsage!.outputTokens
        );
        console.log(`✅ Token tracking — in: ${lastTokenUsage!.inputTokens}, out: ${lastTokenUsage!.outputTokens}, total: ${lastTokenUsage!.totalTokens}`);
    }, { timeout: 30_000 });
});

// ─── 9. System prompt handling ──────────────────────────

describe('Integration: system prompts', () => {

    test('system prompt influences Agent output', async () => {
        if (!hasAnyKey()) {
            console.warn('⏭️  Skipping system prompt test (no API keys set)');
            return;
        }

        const llm = hasOpenAI() ? 'gpt-4o-mini'
            : hasGemini() ? 'gemini-2.0-flash'
                : hasAnthropic() ? 'claude-3-5-sonnet-20241022'
                    : 'deepseek-chat';

        const agent = new Agent({
            llm: llm as any,
            systemPrompt: 'You are a pirate. Always respond in pirate speak. Use words like "arr", "matey", "ahoy".',
            inputFormat: z.object({ question: z.string() }),
            outputFormat: z.object({
                reply: z.string().describe('Your pirate-style response'),
            }),
            temperature: 0.5,
        });

        const result = await agent.run({ question: 'What is your name?' });

        expect(result.reply).toBeTypeOf('string');
        expect(result.reply.length).toBeGreaterThan(5);
        // The LLM should use pirate language — check for common pirate terms
        const pirateTerms = ['arr', 'matey', 'ahoy', 'captain', 'pirate', 'aye', 'sail', 'sea'];
        const hasPirateTerm = pirateTerms.some(term =>
            result.reply.toLowerCase().includes(term)
        );
        expect(hasPirateTerm).toBe(true);
        console.log(`✅ System prompt — pirate reply: "${result.reply.substring(0, 80)}..."`);
    }, { timeout: 60_000 });
});

// ─── 10. Error handling ─────────────────────────────────

describe('Integration: error handling', () => {

    test('callLLM with invalid model throws descriptive error', async () => {
        if (!hasOpenAI()) {
            console.warn('⏭️  Skipping error handling test (OPENAI_API_KEY not set)');
            return;
        }

        try {
            await callLLM(
                'gpt-fake-model-999' as any,
                [{ role: 'user', content: 'hello' }],
                { maxTokens: 10 },
            );
            // Should not reach here
            expect(true).toBe(false);
        } catch (err: any) {
            expect(err).toBeInstanceOf(Error);
            expect(err.message.length).toBeGreaterThan(0);
            console.log(`✅ Error handling — caught: "${err.message.substring(0, 80)}"`);
        }
    }, { timeout: 30_000 });

    test('Agent.run with budget guard rejects expensive calls', async () => {
        if (!hasAnyKey()) {
            console.warn('⏭️  Skipping budget guard test (no API keys set)');
            return;
        }

        const llm = hasOpenAI() ? 'gpt-4o-mini'
            : hasGemini() ? 'gemini-2.0-flash'
                : hasAnthropic() ? 'claude-3-5-sonnet-20241022'
                    : 'deepseek-chat';

        const agent = new Agent({
            llm: llm as any,
            inputFormat: z.object({ text: z.string() }),
            outputFormat: z.object({ reply: z.string() }),
            maxCostUSD: 0.0000001, // Impossibly low budget
        });

        try {
            await agent.run({ text: 'hello' });
            expect(true).toBe(false); // Should not reach
        } catch (err: any) {
            expect(err.message).toContain('exceeds budget');
            console.log(`✅ Budget guard — rejected: "${err.message.substring(0, 80)}"`);
        }
    }, { timeout: 10_000 });
});
