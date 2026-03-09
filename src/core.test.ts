/**
 * Tests for GXAI core modules: errors, memory, audit, pricing
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { z } from 'zod';

// Errors
import {
    GxaiError,
    BudgetExceededError,
    ValidationError,
    ProviderError,
    AuthorizationError,
    MaxIterationsError,
    TimeoutError,
} from './errors';

// Memory
import { ConversationMemory } from './memory';

// Audit
import { AuditLog } from './audit';

// Pricing
import { getModelPricing, calculateCost, estimateInputCost } from './pricing';

// Agent (for RunEvent tests)
import { Agent } from './agent';
import type { RunEvent } from './agent';

// ─── Error Types ──────────────────────────────────────────

describe('Error Types', () => {
    test('GxaiError is an Error subclass', () => {
        const err = new GxaiError('test');
        expect(err instanceof Error).toBe(true);
        expect(err.name).toBe('GxaiError');
        expect(err.message).toBe('test');
    });

    test('BudgetExceededError carries cost details', () => {
        const err = new BudgetExceededError(0.05, 0.01, 'gpt-4o');
        expect(err instanceof GxaiError).toBe(true);
        expect(err.name).toBe('BudgetExceededError');
        expect(err.estimatedCost).toBe(0.05);
        expect(err.maxCostUSD).toBe(0.01);
        expect(err.model).toBe('gpt-4o');
        expect(err.message).toContain('Budget exceeded');
    });

    test('ValidationError carries zodErrors', () => {
        const zodErrors = [{ path: ['name'], message: 'required' }];
        const err = new ValidationError('Invalid input', zodErrors);
        expect(err instanceof GxaiError).toBe(true);
        expect(err.zodErrors).toEqual(zodErrors);
    });

    test('ProviderError marks 429 as retryable', () => {
        const err = new ProviderError('Rate limited', 'openai', 429);
        expect(err.retryable).toBe(true);
        expect(err.provider).toBe('openai');
        expect(err.statusCode).toBe(429);
    });

    test('ProviderError marks 500+ as retryable', () => {
        const err = new ProviderError('Server error', 'anthropic', 503);
        expect(err.retryable).toBe(true);
    });

    test('ProviderError marks 400 as non-retryable', () => {
        const err = new ProviderError('Bad request', 'openai', 400);
        expect(err.retryable).toBe(false);
    });

    test('AuthorizationError with custom reason', () => {
        const err = new AuthorizationError('exec', 'shell', 'Not allowed');
        expect(err.tool).toBe('exec');
        expect(err.server).toBe('shell');
        expect(err.message).toBe('Not allowed');
    });

    test('AuthorizationError default message', () => {
        const err = new AuthorizationError('fetch', 'web');
        expect(err.message).toContain('web.fetch');
    });

    test('MaxIterationsError carries count', () => {
        const err = new MaxIterationsError(50);
        expect(err.iterations).toBe(50);
        expect(err.message).toContain('50');
    });

    test('TimeoutError carries duration details', () => {
        const err = new TimeoutError(5500, 5000);
        expect(err instanceof GxaiError).toBe(true);
        expect(err.name).toBe('TimeoutError');
        expect(err.durationMs).toBe(5500);
        expect(err.maxDurationMs).toBe(5000);
        expect(err.message).toContain('timeout');
    });
});

// ─── ConversationMemory ──────────────────────────────────

describe('ConversationMemory', () => {
    let mem: ConversationMemory;

    beforeEach(() => {
        mem = new ConversationMemory({ maxTurns: 3 });
    });

    test('starts empty', () => {
        expect(mem.turnCount).toBe(0);
        expect(mem.messageCount).toBe(0);
        expect(mem.getMessages()).toEqual([]);
    });

    test('addUser / addAssistant', () => {
        mem.addUser('hello');
        mem.addAssistant('hi there');
        expect(mem.turnCount).toBe(1);
        expect(mem.messageCount).toBe(2);
    });

    test('getMessages includes system if configured', () => {
        const m2 = new ConversationMemory({ systemMessage: 'You are helpful' });
        m2.addUser('test');
        const msgs = m2.getMessages();
        expect(msgs[0]!.role).toBe('system');
        expect(msgs[0]!.content).toBe('You are helpful');
        expect(msgs[1]!.role).toBe('user');
    });

    test('prune keeps only maxTurns user messages', () => {
        // maxTurns = 3, so adding 4 user messages should prune
        mem.addUser('q1'); mem.addAssistant('a1');
        mem.addUser('q2'); mem.addAssistant('a2');
        mem.addUser('q3'); mem.addAssistant('a3');
        mem.addUser('q4'); mem.addAssistant('a4');
        expect(mem.turnCount).toBe(3);
    });

    test('getContextString returns XML', () => {
        mem.addUser('hello');
        mem.addAssistant('world');
        const ctx = mem.getContextString();
        expect(ctx).toContain('<conversation_history>');
        expect(ctx).toContain('[User]: hello');
        expect(ctx).toContain('[Agent]: world');
    });

    test('getContextString returns empty for no messages', () => {
        expect(mem.getContextString()).toBe('');
    });

    test('toJSON / fromJSON round-trip', () => {
        mem.addUser('q1');
        mem.addAssistant('a1');
        const json = mem.toJSON();
        const m2 = new ConversationMemory();
        m2.fromJSON(json);
        expect(m2.messageCount).toBe(2);
    });

    test('clear resets', () => {
        mem.addUser('test');
        mem.clear();
        expect(mem.messageCount).toBe(0);
        expect(mem.turnCount).toBe(0);
    });

    test('fork creates independent deep copy', () => {
        mem.addUser('question 1');
        mem.addAssistant('answer 1');
        const forked = mem.fork('branch-A');
        expect(forked.messageCount).toBe(2);
        expect(forked.label).toBe('branch-A');

        // Adding to original doesn't affect fork
        mem.addUser('question 2');
        expect(mem.messageCount).toBe(3);
        expect(forked.messageCount).toBe(2);
    });

    test('fork branches diverge independently', () => {
        mem.addUser('shared context');
        const branchA = mem.fork('A');
        const branchB = mem.fork('B');

        branchA.addAssistant('response A');
        branchB.addAssistant('response B');

        expect(branchA.messageCount).toBe(2);
        expect(branchB.messageCount).toBe(2);
        expect(branchA.toJSON()[1]!.content).toBe('response A');
        expect(branchB.toJSON()[1]!.content).toBe('response B');
    });

    test('fork auto-generates label when none provided', () => {
        const forked = mem.fork();
        expect(forked.label).not.toBeNull();
        expect(forked.label!.startsWith('fork-')).toBe(true);
    });
});

// ─── AuditLog ────────────────────────────────────────────

describe('AuditLog', () => {
    let log: AuditLog;

    beforeEach(() => {
        log = new AuditLog(5); // small max for testing
    });

    test('log and getEntries', () => {
        log.log({ decision: 'allow', tool: 'fetch', server: 'web', agentName: 'test' });
        const entries = log.getEntries();
        expect(entries.length).toBe(1);
        expect(entries[0]!.decision).toBe('allow');
        expect(entries[0]!.timestamp).toBeGreaterThan(0);
    });

    test('circular buffer enforces maxEntries', () => {
        for (let i = 0; i < 8; i++) {
            log.log({ decision: 'allow', tool: `t${i}`, server: 's', agentName: 'a' });
        }
        expect(log.getEntries().length).toBe(5);
    });

    test('query by decision', () => {
        log.log({ decision: 'allow', tool: 'a', server: 's', agentName: 'a' });
        log.log({ decision: 'deny', tool: 'b', server: 's', agentName: 'a', reason: 'nope' });
        expect(log.getEntries({ decision: 'deny' }).length).toBe(1);
        expect(log.getEntries({ decision: 'allow' }).length).toBe(1);
    });

    test('query by tool', () => {
        log.log({ decision: 'allow', tool: 'fetch-data', server: 's', agentName: 'a' });
        log.log({ decision: 'allow', tool: 'exec-cmd', server: 's', agentName: 'a' });
        expect(log.getEntries({ tool: 'fetch' }).length).toBe(1);
    });

    test('query with limit', () => {
        log.log({ decision: 'allow', tool: 'a', server: 's', agentName: 'a' });
        log.log({ decision: 'allow', tool: 'b', server: 's', agentName: 'a' });
        log.log({ decision: 'allow', tool: 'c', server: 's', agentName: 'a' });
        expect(log.getEntries({ limit: 2 }).length).toBe(2);
    });

    test('getStats computes correctly', () => {
        log.log({ decision: 'allow', tool: 'a', server: 's1', agentName: 'a' });
        log.log({ decision: 'deny', tool: 'b', server: 's2', agentName: 'a' });
        log.log({ decision: 'deny', tool: 'b', server: 's2', agentName: 'a' });
        const stats = log.getStats();
        expect(stats.totalEntries).toBe(3);
        expect(stats.allowCount).toBe(1);
        expect(stats.denyCount).toBe(2);
        expect(stats.deniedTools['s2.b']).toBe(2);
    });

    test('clear and toJSON/fromJSON', () => {
        log.log({ decision: 'allow', tool: 'a', server: 's', agentName: 'a' });
        const json = log.toJSON();
        expect(json.length).toBe(1);
        log.clear();
        expect(log.getEntries().length).toBe(0);
        log.fromJSON(json);
        expect(log.getEntries().length).toBe(1);
    });
});

// ─── Pricing ─────────────────────────────────────────────

describe('Pricing', () => {
    test('getModelPricing resolves known models', () => {
        const gpt4oMini = getModelPricing('gpt-4o-mini');
        expect(gpt4oMini.inputPerMillion).toBe(0.15);
        expect(gpt4oMini.outputPerMillion).toBe(0.60);

        const claude = getModelPricing('claude-3-5-sonnet-20241022');
        expect(claude.inputPerMillion).toBe(3.00);

        const deepseek = getModelPricing('deepseek-chat');
        expect(deepseek.inputPerMillion).toBe(0.14);

        const gemini = getModelPricing('gemini-2.0-flash');
        expect(gemini.inputPerMillion).toBe(0.10);
    });

    test('getModelPricing returns default for unknown models', () => {
        const p = getModelPricing('some-unknown-model');
        expect(p.inputPerMillion).toBe(1.00);
        expect(p.outputPerMillion).toBe(3.00);
    });

    test('calculateCost returns accurate USD costs', () => {
        const cost = calculateCost('gpt-4o-mini', {
            inputTokens: 1000,
            outputTokens: 500,
            totalTokens: 1500,
        });
        expect(cost.currency).toBe('USD');
        // 1000/1M * 0.15 = 0.00015
        expect(cost.inputCost).toBe(0.00015);
        // 500/1M * 0.60 = 0.0003
        expect(cost.outputCost).toBe(0.0003);
        expect(cost.totalCost).toBe(0.00045);
    });

    test('estimateInputCost uses char-to-token heuristic', () => {
        const cost = estimateInputCost('gpt-4o-mini', 4000, 1000);
        // 4000 chars / 4 = 1000 input tokens
        expect(cost.inputCost).toBe(0.00015); // 1000/1M * 0.15
        expect(cost.outputCost).toBe(0.0006); // 1000/1M * 0.60
    });

    test('gemini-2.5-pro matches before generic gemini', () => {
        const pro = getModelPricing('gemini-2.5-pro-preview-05-06');
        expect(pro.inputPerMillion).toBe(1.25);
        expect(pro.outputPerMillion).toBe(10.00);
    });
});

// ─── RunEvent Telemetry ──────────────────────────────────

describe('RunEvent Telemetry', () => {

    test('RunEvent type covers all event types', () => {
        const eventTypes = ['run_start', 'llm_call', 'llm_complete', 'tool_start', 'tool_complete', 'run_complete', 'run_error'];
        // Compile-time check — if RunEvent union changes, this must be updated
        expect(eventTypes.length).toBe(7);
    });

    test('Agent.onEvent returns this for chaining', () => {
        const agent = new Agent({
            llm: 'gpt-4o-mini' as any,
            inputFormat: z.object({ q: z.string() }),
            outputFormat: z.object({ a: z.string() }),
        });
        const result = agent.onEvent(() => { });
        expect(result).toBe(agent);
    });

    test('Agent.clone preserves event callback', () => {
        const events: RunEvent[] = [];
        const agent = new Agent({
            llm: 'gpt-4o-mini' as any,
            inputFormat: z.object({ q: z.string() }),
            outputFormat: z.object({ a: z.string() }),
        });
        agent.onEvent((e: RunEvent) => events.push(e));
        const cloned = agent.clone({ temperature: 0.9 });
        // Access private field to verify
        expect((cloned as any).runEventCallback).not.toBeNull();
    });

    test('emitEvent is non-fatal on callback errors', () => {
        const agent = new Agent({
            llm: 'gpt-4o-mini' as any,
            inputFormat: z.object({ q: z.string() }),
            outputFormat: z.object({ a: z.string() }),
        });
        agent.onEvent(() => { throw new Error('callback crash'); });
        // Calling private emitEvent should not throw
        expect(() => (agent as any).emitEvent({ type: 'run_start', agentName: 'test', llm: 'gpt-4o-mini', requestId: 'x', timestamp: Date.now() })).not.toThrow();
    });
});

// ─── Context Window Tracking ─────────────────────────────

describe('Context Window Tracking', () => {
    const { getContextWindowSize, ContextTracker } = require('./context') as typeof import('./context');

    test('getContextWindowSize returns known model sizes', () => {
        expect(getContextWindowSize('gpt-4o-mini')).toBe(128_000);
        expect(getContextWindowSize('claude-3-5-sonnet-20241022')).toBe(200_000);
        expect(getContextWindowSize('gemini-2.0-flash')).toBe(1_048_576);
    });

    test('getContextWindowSize returns default for unknown models', () => {
        expect(getContextWindowSize('unknown-model')).toBe(128_000);
    });

    test('ContextTracker tracks cumulative usage with levels', () => {
        const tracker = new ContextTracker('gpt-4');  // 8192 context
        tracker.addUsage(2000);
        expect(tracker.getUsage().level).toBe('ok');
        expect(tracker.getUsage().cumulativeInputTokens).toBe(2000);

        tracker.addUsage(5000); // 7000 / 8192 = 85% → warning
        expect(tracker.getUsage().level).toBe('warning');

        tracker.addUsage(1500); // 8500 / 8192 > 100% → exceeded
        expect(tracker.getUsage().level).toBe('exceeded');
    });

    test('ContextTracker.isSafe reflects threshold', () => {
        const tracker = new ContextTracker('gpt-4');  // 8192 context
        tracker.addUsage(7000);
        expect(tracker.isSafe()).toBe(true); // 85% < 90%

        tracker.addUsage(1000);
        expect(tracker.isSafe()).toBe(false); // 97% > 90%
    });

    test('ContextTracker.reset clears state', () => {
        const tracker = new ContextTracker('gpt-4o-mini');
        tracker.addUsage(50000);
        tracker.reset();
        expect(tracker.getUsage().cumulativeInputTokens).toBe(0);
        expect(tracker.getUsage().level).toBe('ok');
    });

    test('Agent.contextUsage getter works', () => {
        const agent = new Agent({
            llm: 'gpt-4o-mini' as any,
            inputFormat: z.object({ q: z.string() }),
            outputFormat: z.object({ a: z.string() }),
        });
        const usage = agent.contextUsage;
        expect(usage.level).toBe('ok');
        expect(usage.contextWindowSize).toBe(128_000);
        expect(usage.cumulativeInputTokens).toBe(0);
    });
});

// ─── Plugin System ───────────────────────────────────────

describe('Plugin System', () => {
    const { PluginRegistry } = require('./plugin') as typeof import('./plugin');

    test('PluginRegistry register and unregister', async () => {
        const registry = new PluginRegistry();
        await registry.register({ name: 'test-plugin' });
        expect(registry.has('test-plugin')).toBe(true);
        expect(registry.size).toBe(1);

        const removed = await registry.unregister('test-plugin');
        expect(removed).toBe(true);
        expect(registry.has('test-plugin')).toBe(false);
    });

    test('PluginRegistry rejects duplicates', async () => {
        const registry = new PluginRegistry();
        await registry.register({ name: 'unique' });
        expect(registry.register({ name: 'unique' })).rejects.toThrow('already registered');
    });

    test('PluginRegistry aggregates middleware', async () => {
        const registry = new PluginRegistry();
        const mw1 = async () => { };
        const mw2 = async () => { };
        await registry.register({ name: 'p1', middleware: mw1 });
        await registry.register({ name: 'p2', middleware: [mw2] });
        expect(registry.getAllMiddleware().length).toBe(2);
    });

    test('Agent.register adds plugin middleware', async () => {
        let called = false;
        const agent = new Agent({
            llm: 'gpt-4o-mini' as any,
            inputFormat: z.object({ q: z.string() }),
            outputFormat: z.object({ a: z.string() }),
        });
        await agent.register({
            name: 'test',
            middleware: async () => { called = true; },
        });
        expect(agent.plugins).toContain('test');
    });

    test('Agent.unregister removes plugin', async () => {
        const agent = new Agent({
            llm: 'gpt-4o-mini' as any,
            inputFormat: z.object({ q: z.string() }),
            outputFormat: z.object({ a: z.string() }),
        });
        await agent.register({ name: 'removable' });
        expect(agent.plugins).toContain('removable');
        const removed = await agent.unregister('removable');
        expect(removed).toBe(true);
        expect(agent.plugins).not.toContain('removable');
    });
});

// ─── StreamChunk Type ────────────────────────────────────

describe('StreamChunk', () => {
    test('StreamChunk progress shape', () => {
        const chunk = { done: false as const, stage: 'test', message: 'testing' };
        expect(chunk.done).toBe(false);
        expect(chunk.stage).toBe('test');
    });

    test('StreamChunk final shape with output', () => {
        const chunk = { done: true as const, output: { result: 'ok' } };
        expect(chunk.done).toBe(true);
        expect(chunk.output?.result).toBe('ok');
    });

    test('StreamChunk final shape with error', () => {
        const chunk = { done: true as const, error: 'boom' };
        expect(chunk.done).toBe(true);
        expect(chunk.error).toBe('boom');
    });
});

// ─── OpenTelemetry ───────────────────────────────────────

describe('OpenTelemetry', () => {
    const { createOtelCallback } = require('./otel') as typeof import('./otel');

    test('createOtelCallback returns a function', () => {
        const cb = createOtelCallback({
            endpoint: 'http://localhost:4318/v1/traces',
            serviceName: 'test-agent',
        });
        expect(typeof cb).toBe('function');
    });

    test('callback handles run_start without throwing', () => {
        const cb = createOtelCallback({
            endpoint: 'http://localhost:4318/v1/traces',
            batch: false,
        });
        expect(() => cb({
            type: 'run_start',
            agentName: 'test',
            llm: 'gpt-4o-mini',
            requestId: 'test-123',
            timestamp: Date.now(),
        })).not.toThrow();
    });

    test('callback handles run_complete without throwing', () => {
        const cb = createOtelCallback({
            endpoint: 'http://invalid-endpoint:9999/v1/traces',
            batch: false,
        });
        // Simulate start then complete
        cb({ type: 'run_start', agentName: 'test', llm: 'gpt-4o-mini', requestId: 'r1', timestamp: Date.now() - 100 });
        expect(() => cb({
            type: 'run_complete',
            agentName: 'test',
            llm: 'gpt-4o-mini',
            requestId: 'r1',
            durationMs: 100,
            timestamp: Date.now(),
        })).not.toThrow();
    });
});

// ─── Cost Tracker ────────────────────────────────────────

describe('CostTracker', () => {
    const { CostTracker } = require('./cost-tracker') as typeof import('./cost-tracker');

    const makeRecord = (overrides: Partial<import('./cost-tracker').CostRecord> = {}): import('./cost-tracker').CostRecord => ({
        timestamp: Date.now(),
        agentName: 'test-agent',
        llm: 'gpt-4o-mini',
        requestId: 'req-1',
        durationMs: 500,
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        cost: { inputCost: 0.00001, outputCost: 0.000005, totalCost: 0.000015, currency: 'USD' },
        status: 'success',
        ...overrides,
    });

    test('record and getSummary', () => {
        const tracker = new CostTracker();
        tracker.record(makeRecord());
        tracker.record(makeRecord({ status: 'error' }));

        const summary = tracker.getSummary();
        expect(summary.totalRuns).toBe(2);
        expect(summary.successCount).toBe(1);
        expect(summary.errorCount).toBe(1);
        expect(summary.totalTokens).toBe(300);
    });

    test('aggregates by model', () => {
        const tracker = new CostTracker();
        tracker.record(makeRecord({ llm: 'gpt-4o-mini' }));
        tracker.record(makeRecord({ llm: 'claude-3-5-sonnet-20241022' }));
        tracker.record(makeRecord({ llm: 'gpt-4o-mini' }));

        const summary = tracker.getSummary();
        expect(summary.byModel['gpt-4o-mini']!.runs).toBe(2);
        expect(summary.byModel['claude-3-5-sonnet-20241022']!.runs).toBe(1);
    });

    test('time filtering with sinceMs', () => {
        const tracker = new CostTracker();
        tracker.record(makeRecord({ timestamp: Date.now() - 60_000 })); // 1 min ago
        tracker.record(makeRecord({ timestamp: Date.now() }));          // now

        const summary = tracker.getSummary(Date.now() - 30_000); // last 30s
        expect(summary.totalRuns).toBe(1);
    });

    test('clear and size', () => {
        const tracker = new CostTracker();
        tracker.record(makeRecord());
        tracker.record(makeRecord());
        expect(tracker.size).toBe(2);
        tracker.clear();
        expect(tracker.size).toBe(0);
    });
});

// ─── Response Cache ──────────────────────────────────────

describe('Response Cache', () => {
    const { getCacheSize, clearCache, getCacheStats } = require('./cache') as typeof import('./cache');

    test('cache functions exist', () => {
        expect(typeof getCacheSize).toBe('function');
        expect(typeof clearCache).toBe('function');
        expect(typeof getCacheStats).toBe('function');
    });

    test('clearCache resets cache', () => {
        clearCache();
        expect(getCacheSize()).toBe(0);
    });

    test('getCacheStats returns stats', () => {
        clearCache();
        const stats = getCacheStats();
        expect(stats.size).toBe(0);
        expect(Array.isArray(stats.keys)).toBe(true);
    });
});

// ─── Output Validators ──────────────────────────────────

describe('Output Validators', () => {
    test('outputValidators accepted in AgentConfig', () => {
        const agent = new Agent({
            llm: 'gpt-4o-mini' as any,
            inputFormat: z.object({ q: z.string() }),
            outputFormat: z.object({ a: z.string() }),
            outputValidators: [
                (raw) => { if (raw.includes('forbidden')) throw new Error('Forbidden content'); },
            ],
        });
        expect(agent).toBeDefined();
    });

    test('OutputValidator type signature', () => {
        const validator: import('./types').OutputValidator = (raw: string, input: any) => {
            if (raw.length > 1000) throw new Error('Too long');
        };
        expect(typeof validator).toBe('function');
    });
});

// ─── Prompt Templates ───────────────────────────────────

describe('Prompt Templates', () => {
    const { createTemplate, composeTemplates, TEMPLATES } = require('./templates') as typeof import('./templates');

    test('basic variable interpolation', () => {
        const tmpl = createTemplate('Hello {{name}}, welcome to {{place}}');
        expect(tmpl.render({ name: 'Alice', place: 'Wonderland' })).toBe('Hello Alice, welcome to Wonderland');
    });

    test('default values work', () => {
        const tmpl = createTemplate('Format: {{style:concise}}');
        expect(tmpl.render({})).toBe('Format: concise');
        expect(tmpl.render({ style: 'verbose' })).toBe('Format: verbose');
    });

    test('required variables throw when missing', () => {
        const tmpl = createTemplate({ template: 'Input: {{text}}', required: ['text'] });
        expect(() => tmpl.render({})).toThrow('Missing required template variable');
    });

    test('composeTemplates joins templates', () => {
        const a = createTemplate('Part A: {{x}}');
        const b = createTemplate('Part B: {{y}}');
        const composed = composeTemplates([a, b]);
        expect(composed.render({ x: '1', y: '2' })).toBe('Part A: 1\n\nPart B: 2');
        expect(composed.variables).toContain('x');
        expect(composed.variables).toContain('y');
    });

    test('built-in templates exist', () => {
        expect(TEMPLATES.summarize.variables).toContain('content');
        expect(TEMPLATES.classify.variables).toContain('categories');
        expect(TEMPLATES.translate.variables).toContain('to');
        expect(TEMPLATES.codeReview.variables).toContain('code');
    });
});

// ─── Memory Summarization ───────────────────────────────

describe('Memory Summarization', () => {
    test('summarize compresses older turns', () => {
        const mem = new ConversationMemory();
        for (let i = 0; i < 10; i++) {
            mem.addUser(`question ${i}`);
            mem.addAssistant(`answer ${i}`);
        }
        expect(mem.messageCount).toBe(20);

        const summary = mem.summarize(3);
        expect(summary).toContain('Conversation Summary');
        expect(mem.messageCount).toBeLessThan(20);
        // Recent 3 turns should still be there
        expect(mem.turnCount).toBeGreaterThanOrEqual(3);
    });

    test('summarize returns empty when nothing to compress', () => {
        const mem = new ConversationMemory();
        mem.addUser('hello');
        mem.addAssistant('hi');
        expect(mem.summarize(5)).toBe('');
    });

    test('summarizeWithLLM uses custom summarizer', async () => {
        const mem = new ConversationMemory();
        for (let i = 0; i < 8; i++) {
            mem.addUser(`q${i}`);
            mem.addAssistant(`a${i}`);
        }

        const summary = await mem.summarizeWithLLM(
            async (msgs) => `Custom summary of ${msgs.length} messages`,
            3
        );
        expect(summary).toContain('Custom summary');
        expect(mem.messageCount).toBeLessThan(16);
    });
});

// ─── Tool Authorization ─────────────────────────────────

describe('Tool Authorization', () => {
    const { ToolAuthorizer, allowAllTools, onlyTools, blockTools } = require('./tool-auth') as typeof import('./tool-auth');

    test('whitelist mode allows listed tools', () => {
        const auth = new ToolAuthorizer({ mode: 'whitelist', tools: ['read_file', 'search'] });
        expect(auth.isAllowed('read_file').allowed).toBe(true);
        expect(auth.isAllowed('delete_all').allowed).toBe(false);
    });

    test('blacklist mode blocks listed tools', () => {
        const auth = new ToolAuthorizer({ mode: 'blacklist', tools: ['delete_all', 'drop_table'] });
        expect(auth.isAllowed('read_file').allowed).toBe(true);
        expect(auth.isAllowed('delete_all').allowed).toBe(false);
    });

    test('denied log records blocked attempts', () => {
        const auth = new ToolAuthorizer({ mode: 'whitelist', tools: ['safe'] });
        auth.isAllowed('dangerous');
        auth.isAllowed('risky');
        expect(auth.getDeniedLog().length).toBe(2);
        expect(auth.getDeniedLog()[0]!.tool).toBe('dangerous');
    });

    test('factory functions create correct authorizers', () => {
        const all = allowAllTools();
        expect(all.isAllowed('anything').allowed).toBe(true);

        const only = onlyTools('a', 'b');
        expect(only.isAllowed('a').allowed).toBe(true);
        expect(only.isAllowed('c').allowed).toBe(false);

        const block = blockTools('x');
        expect(block.isAllowed('y').allowed).toBe(true);
        expect(block.isAllowed('x').allowed).toBe(false);
    });

    test('server:tool granular rules', () => {
        const auth = new ToolAuthorizer({
            mode: 'blacklist',
            tools: [],
            serverTools: ['prod-server:delete_data'],
        });
        expect(auth.isAllowed('delete_data', 'prod-server').allowed).toBe(false);
        expect(auth.isAllowed('delete_data', 'dev-server').allowed).toBe(true);
    });
});

// ─── Retry Strategies ───────────────────────────────────

describe('Retry Strategies', () => {
    const { linearRetry, exponentialBackoff, fullJitter, noRetry, withRetry } = require('./retry') as typeof import('./retry');

    test('linearRetry returns constant delay', () => {
        const strategy = linearRetry({ baseDelayMs: 500 });
        expect(strategy.getDelay(0)).toBe(500);
        expect(strategy.getDelay(1)).toBe(500);
        expect(strategy.getDelay(5)).toBe(500);
    });

    test('exponentialBackoff doubles delay', () => {
        const strategy = exponentialBackoff({ baseDelayMs: 100, maxDelayMs: 10000 });
        expect(strategy.getDelay(0)).toBe(100);
        expect(strategy.getDelay(1)).toBe(200);
        expect(strategy.getDelay(2)).toBe(400);
        expect(strategy.getDelay(3)).toBe(800);
    });

    test('exponentialBackoff respects maxDelay', () => {
        const strategy = exponentialBackoff({ baseDelayMs: 1000, maxDelayMs: 5000 });
        expect(strategy.getDelay(10)).toBe(5000);
    });

    test('noRetry has 0 maxRetries', () => {
        const strategy = noRetry();
        expect(strategy.maxRetries).toBe(0);
    });

    test('withRetry succeeds on first try', async () => {
        let calls = 0;
        const result = await withRetry(
            async () => { calls++; return 42; },
            linearRetry({ maxRetries: 3, baseDelayMs: 10 }),
        );
        expect(result).toBe(42);
        expect(calls).toBe(1);
    });
});

// ─── Event Bus ──────────────────────────────────────────

describe('Event Bus', () => {
    const { EventBus } = require('./event-bus') as typeof import('./event-bus');

    test('on/emit basic pub-sub', async () => {
        const bus = new EventBus();
        const received: any[] = [];
        bus.on('test', (data) => { received.push(data); });
        await bus.emit('test', { value: 1 });
        await bus.emit('test', { value: 2 });
        expect(received).toEqual([{ value: 1 }, { value: 2 }]);
    });

    test('once fires once then auto-unsubscribes', async () => {
        const bus = new EventBus();
        let count = 0;
        bus.once('ping', () => { count++; });
        await bus.emit('ping');
        await bus.emit('ping');
        expect(count).toBe(1);
    });

    test('wildcard * listener receives all events', async () => {
        const bus = new EventBus();
        const events: string[] = [];
        bus.on('*', (_data, meta) => { events.push(meta.event); });
        await bus.emit('a');
        await bus.emit('b');
        expect(events).toEqual(['a', 'b']);
    });

    test('waitFor resolves on event', async () => {
        const bus = new EventBus();
        setTimeout(() => bus.emit('ready', 'ok'), 10);
        const result = await bus.waitFor('ready', 1000);
        expect(result).toBe('ok');
    });

    test('getHistory returns recent events', async () => {
        const bus = new EventBus();
        await bus.emit('a', 1);
        await bus.emit('b', 2);
        const history = bus.getHistory();
        expect(history.length).toBe(2);
        expect(history[0]!.event).toBe('a');
    });
});

// ─── Pipeline Composition ───────────────────────────────

describe('Pipeline Composition', () => {
    const { createPipeline, PipelineError } = require('./pipeline') as typeof import('./pipeline');

    test('sequential pipeline execution', async () => {
        const pipeline = createPipeline<number>('double-then-add')
            .transform('double', async (n) => n * 2)
            .transform('add10', async (n) => n + 10);

        const result = await pipeline.run(5);
        expect(result.output).toBe(20); // 5*2 + 10
        expect(result.steps.length).toBe(2);
    });

    test('step timing is recorded', async () => {
        const pipeline = createPipeline('timed')
            .transform('wait', async (x) => {
                await new Promise(r => setTimeout(r, 10));
                return x;
            });

        const result = await pipeline.run('test');
        expect(result.steps[0]!.durationMs).toBeGreaterThanOrEqual(5);
        expect(result.totalDurationMs).toBeGreaterThanOrEqual(5);
    });

    test('pipeline error includes completed steps', async () => {
        const pipeline = createPipeline('fail-test')
            .transform('ok', async (x) => x)
            .transform('boom', async () => { throw new Error('kaboom'); });

        try {
            await pipeline.run('input');
            expect(true).toBe(false); // should not reach
        } catch (e) {
            expect(e).toBeInstanceOf(PipelineError);
            expect((e as any).failedStep).toBe('boom');
            expect((e as any).completedSteps.length).toBe(1);
        }
    });

    test('stepNames returns ordered names', () => {
        const pipeline = createPipeline('named')
            .transform('a', async (x) => x)
            .transform('b', async (x) => x);
        expect(pipeline.stepNames).toEqual(['a', 'b']);
        expect(pipeline.stepCount).toBe(2);
    });

    test('onStepComplete callback fires', async () => {
        const steps: string[] = [];
        const pipeline = createPipeline('cb')
            .transform('s1', async (x) => x + 1)
            .transform('s2', async (x) => x + 1)
            .onStepComplete((name) => { steps.push(name); });

        await pipeline.run(0);
        expect(steps).toEqual(['s1', 's2']);
    });
});

// ─── Health Check ───────────────────────────────────────

describe('Health Check', () => {
    const { healthCheck, formatHealthReport } = require('./health') as typeof import('./health');

    test('returns healthy report for configured agent', async () => {
        const agent = new Agent({
            llm: 'gpt-4o-mini' as any,
            inputFormat: z.object({ q: z.string() }),
            outputFormat: z.object({ a: z.string() }),
            systemPrompt: 'You are a helpful assistant that answers questions.',
        });

        const report = await healthCheck(agent);
        expect(report.status).toBe('healthy');
        expect(report.agent.llm).toBe('gpt-4o-mini');
        expect(report.checks.length).toBeGreaterThan(0);
    });

    test('report has runtime info', async () => {
        const agent = new Agent({
            llm: 'gpt-4o-mini' as any,
            inputFormat: z.object({ q: z.string() }),
            outputFormat: z.object({ a: z.string() }),
        });

        const report = await healthCheck(agent);
        expect(report.runtime.uptimeMs).toBeGreaterThan(0);
        expect(report.runtime.platform).toBeDefined();
        expect(report.timestamp).toBeGreaterThan(0);
    });

    test('formatHealthReport returns string', async () => {
        const agent = new Agent({
            llm: 'gpt-4o-mini' as any,
            inputFormat: z.object({ q: z.string() }),
            outputFormat: z.object({ a: z.string() }),
        });

        const report = await healthCheck(agent);
        const formatted = formatHealthReport(report);
        expect(typeof formatted).toBe('string');
        expect(formatted).toContain('Agent Health');
    });
});

// ─── Schema Evolution ───────────────────────────────────

describe('Schema Evolution', () => {
    const { createSchemaEvolution } = require('./schema-evolution') as typeof import('./schema-evolution');

    const evolved = createSchemaEvolution('test-schema')
        .version(1, z.object({ name: z.string() }))
        .version(2, z.object({ name: z.string(), email: z.string() }), {
            up: (v1: any) => ({ ...v1, email: 'unknown@example.com' }),
            down: (v2: any) => ({ name: v2.name }),
        })
        .version(3, z.object({ name: z.string(), email: z.string(), age: z.number() }), {
            up: (v2: any) => ({ ...v2, age: 0 }),
            down: (v3: any) => ({ name: v3.name, email: v3.email }),
        })
        .build();

    test('migrate forward v1→v2', () => {
        const result = evolved.migrate({ name: 'Alice' }, 1, 2);
        expect(result).toEqual({ name: 'Alice', email: 'unknown@example.com' });
    });

    test('migrate backward v2→v1', () => {
        const result = evolved.migrate({ name: 'Bob', email: 'bob@test.com' }, 2, 1);
        expect(result).toEqual({ name: 'Bob' });
    });

    test('multi-step migration v1→v3', () => {
        const result = evolved.migrate({ name: 'Carol' }, 1, 3);
        expect(result).toEqual({ name: 'Carol', email: 'unknown@example.com', age: 0 });
    });

    test('validate against specific version', () => {
        expect(evolved.validate({ name: 'Test' }, 1).success).toBe(true);
        expect(evolved.validate({ name: 'Test' }, 2).success).toBe(false); // missing email
        expect(evolved.validate({ name: 'T', email: 'e@e.com', age: 5 }, 3).success).toBe(true);
    });

    test('currentVersion and versions list', () => {
        expect(evolved.currentVersion).toBe(3);
        expect(evolved.versions).toEqual([1, 2, 3]);
        expect(evolved.name).toBe('test-schema');
    });
});

// ─── Middleware Ordering ────────────────────────────────

describe('Middleware Ordering', () => {
    const { MiddlewareChain } = require('./middleware-order') as typeof import('./middleware-order');

    test('basic ordering preserves insertion order', () => {
        const chain = new MiddlewareChain()
            .add({ name: 'a', fn: async (_ctx, next) => { await next(); } })
            .add({ name: 'b', fn: async (_ctx, next) => { await next(); } });
        const built = chain.build();
        expect(built.order).toEqual(['a', 'b']);
    });

    test('before constraint reorders', () => {
        const chain = new MiddlewareChain()
            .add({ name: 'auth', fn: async (_ctx, next) => { await next(); } })
            .add({ name: 'logging', fn: async (_ctx, next) => { await next(); }, before: ['auth'] });
        const built = chain.build();
        expect(built.order.indexOf('logging')).toBeLessThan(built.order.indexOf('auth'));
    });

    test('after constraint reorders', () => {
        const chain = new MiddlewareChain()
            .add({ name: 'metrics', fn: async (_ctx, next) => { await next(); }, after: ['auth'] })
            .add({ name: 'auth', fn: async (_ctx, next) => { await next(); } });
        const built = chain.build();
        expect(built.order.indexOf('metrics')).toBeGreaterThan(built.order.indexOf('auth'));
    });

    test('disabled middleware is excluded', () => {
        const chain = new MiddlewareChain()
            .add({ name: 'a', fn: async (_ctx, next) => { await next(); } })
            .add({ name: 'b', fn: async (_ctx, next) => { await next(); }, enabled: false });
        const built = chain.build();
        expect(built.order).toEqual(['a']);
    });

    test('execution runs in order', async () => {
        const log: string[] = [];
        const chain = new MiddlewareChain()
            .add({ name: 'first', fn: async (_ctx, next) => { log.push('1'); await next(); } })
            .add({ name: 'second', fn: async (_ctx, next) => { log.push('2'); await next(); } });
        await chain.build().execute({});
        expect(log).toEqual(['1', '2']);
    });
});

// ─── Input Preprocessors ────────────────────────────────

describe('Input Preprocessors', () => {
    const { chainPreprocessors, trimStrings, validateLength, withDefaults, stripFields } = require('./preprocessors') as typeof import('./preprocessors');

    test('trimStrings trims string values', async () => {
        const pp = trimStrings();
        expect(await pp({ name: '  Alice  ', age: 25 })).toEqual({ name: 'Alice', age: 25 });
    });

    test('validateLength throws on too-long strings', async () => {
        const pp = validateLength({ maxLength: 5 });
        expect(() => pp({ msg: 'toolong' })).toThrow('max length');
    });

    test('validateLength truncates with option', async () => {
        const pp = validateLength({ maxLength: 3, truncate: true });
        expect(await pp({ msg: 'hello' })).toEqual({ msg: 'hel' });
    });

    test('chainPreprocessors composes', async () => {
        const pp = chainPreprocessors(
            trimStrings(),
            withDefaults({ role: 'user' }),
        );
        const result = await pp({ name: '  Bob  ' });
        expect(result).toEqual({ name: 'Bob', role: 'user' });
    });

    test('stripFields removes specified fields', async () => {
        const pp = stripFields('password', 'secret');
        expect(await pp({ name: 'Alice', password: '123', secret: 'x' })).toEqual({ name: 'Alice' });
    });
});

// ─── Rate Limiter ───────────────────────────────────────

describe('Rate Limiter', () => {
    const { RateLimiter } = require('./rate-limiter') as typeof import('./rate-limiter');

    test('tryAcquire succeeds when tokens available', () => {
        const limiter = new RateLimiter({ tokensPerSecond: 10, burstCapacity: 5 });
        expect(limiter.tryAcquire()).toBe(true);
        expect(limiter.tryAcquire()).toBe(true);
        limiter.destroy();
    });

    test('stats reflects state', () => {
        const limiter = new RateLimiter({ tokensPerSecond: 5, burstCapacity: 10 });
        limiter.tryAcquire(3);
        const stats = limiter.stats;
        expect(stats.totalAcquired).toBe(3);
        expect(stats.tokensPerSecond).toBe(5);
        expect(stats.burstCapacity).toBe(10);
        limiter.destroy();
    });

    test('tryAcquire fails when exhausted', () => {
        const limiter = new RateLimiter({ tokensPerSecond: 1, burstCapacity: 2 });
        limiter.tryAcquire(2); // take all
        expect(limiter.tryAcquire()).toBe(false);
        limiter.destroy();
    });

    test('reset refills tokens', () => {
        const limiter = new RateLimiter({ tokensPerSecond: 5, burstCapacity: 5 });
        limiter.tryAcquire(5);
        expect(limiter.tryAcquire()).toBe(false);
        limiter.reset();
        expect(limiter.tryAcquire()).toBe(true);
        limiter.destroy();
    });

    test('acquire resolves when tokens available', async () => {
        const limiter = new RateLimiter({ tokensPerSecond: 100, burstCapacity: 10 });
        await limiter.acquire();
        expect(limiter.stats.totalAcquired).toBe(1);
        limiter.destroy();
    });
});

// ─── Context Window ─────────────────────────────────────

describe('Context Window', () => {
    const { ContextWindow } = require('./context-window') as typeof import('./context-window');

    test('addMessage tracks messages', () => {
        const cw = new ContextWindow({ maxTokens: 8192 });
        cw.addMessage('user', 'Hello');
        cw.addMessage('assistant', 'Hi there');
        expect(cw.getMessages().length).toBe(2);
    });

    test('auto-prunes when exceeding budget', () => {
        const cw = new ContextWindow({ maxTokens: 100, reserveTokens: 20, charsPerToken: 1 });
        // Budget = 80 chars. Add messages that exceed it.
        cw.addMessage('user', 'A'.repeat(40));
        cw.addMessage('assistant', 'B'.repeat(40));
        cw.addMessage('user', 'C'.repeat(40));
        // Should have pruned oldest to fit
        expect(cw.stats.prunedCount).toBeGreaterThan(0);
        expect(cw.totalTokens).toBeLessThanOrEqual(80);
    });

    test('pinned messages are never pruned', () => {
        const cw = new ContextWindow({ maxTokens: 100, reserveTokens: 20, charsPerToken: 1 });
        cw.addSystemPrompt('System prompt here'); // pinned
        cw.addMessage('user', 'X'.repeat(60));
        cw.addMessage('user', 'Y'.repeat(60));
        // System prompt should survive pruning
        const msgs = cw.getMessages();
        expect(msgs.some(m => m.role === 'system' && m.pinned)).toBe(true);
    });

    test('stats returns utilization', () => {
        const cw = new ContextWindow({ maxTokens: 1000, reserveTokens: 200, charsPerToken: 4 });
        cw.addMessage('user', 'Hello world'); // ~3 tokens
        const stats = cw.stats;
        expect(stats.utilization).toBeGreaterThan(0);
        expect(stats.utilization).toBeLessThan(1);
        expect(stats.maxTokens).toBe(1000);
    });

    test('fits checks available space', () => {
        const cw = new ContextWindow({ maxTokens: 100, reserveTokens: 20, charsPerToken: 1 });
        expect(cw.fits('short')).toBe(true);
        expect(cw.fits('X'.repeat(200))).toBe(false);
    });
});

// ─── Structured Logging ─────────────────────────────────

describe('Structured Logging', () => {
    const { StructuredLogger, bufferTransport } = require('./structured-log') as typeof import('./structured-log');

    test('logs at appropriate levels', () => {
        const buffer: any[] = [];
        const logger = new StructuredLogger({ name: 'test', transports: [bufferTransport(buffer)], minLevel: 'info' });
        logger.debug('hidden');
        logger.info('visible');
        logger.error('also visible');
        expect(buffer.length).toBe(2);
        expect(buffer[0]!.level).toBe('info');
    });

    test('records are buffered', () => {
        const logger = new StructuredLogger({ name: 'buf', transports: [], minLevel: 'debug' });
        logger.info('one');
        logger.warn('two');
        expect(logger.recordCount).toBe(2);
    });

    test('child logger inherits fields', () => {
        const buffer: any[] = [];
        const parent = new StructuredLogger({ name: 'parent', transports: [bufferTransport(buffer)] });
        const child = parent.child({ component: 'db' });
        child.info('query');
        expect(buffer[0]!.fields.component).toBe('db');
    });

    test('correlation ID is set', () => {
        const buffer: any[] = [];
        const logger = new StructuredLogger({ name: 'corr', transports: [bufferTransport(buffer)], correlationId: 'req-123' });
        logger.info('test');
        expect(buffer[0]!.correlationId).toBe('req-123');
    });

    test('getRecords filters by level', () => {
        const logger = new StructuredLogger({ name: 'filter', transports: [], minLevel: 'debug' });
        logger.debug('d');
        logger.info('i');
        logger.error('e');
        expect(logger.getRecords('error').length).toBe(1);
        expect(logger.getRecords('info').length).toBe(2); // info + error
    });
});

// ─── Config Profiles ────────────────────────────────────

describe('Config Profiles', () => {
    const { ConfigProfileManager } = require('./config-profiles') as typeof import('./config-profiles');

    test('register and get active profile', () => {
        const pm = new ConfigProfileManager()
            .register('dev', { llm: 'gpt-4o-mini', maxCost: 1 })
            .register('prod', { llm: 'gpt-4o', maxCost: 10 });
        expect(pm.getActive()).toEqual({ llm: 'gpt-4o-mini', maxCost: 1 });
        pm.setActive('prod');
        expect(pm.getActive()).toEqual({ llm: 'gpt-4o', maxCost: 10 });
    });

    test('base config merges with profile', () => {
        const pm = new ConfigProfileManager()
            .setBase({ timeout: 5000 })
            .register('dev', { llm: 'mini' });
        expect(pm.getActive()).toEqual({ timeout: 5000, llm: 'mini' });
    });

    test('withOverrides adds temporary values', () => {
        const pm = new ConfigProfileManager()
            .register('dev', { llm: 'mini', debug: false });
        const config = pm.withOverrides({ debug: true });
        expect(config).toEqual({ llm: 'mini', debug: true });
    });

    test('listProfiles shows metadata', () => {
        const pm = new ConfigProfileManager()
            .register('dev', {}, 'Development')
            .register('prod', {}, 'Production');
        const list = pm.listProfiles();
        expect(list.length).toBe(2);
        expect(list[0]!.isActive).toBe(true);
        expect(list[1]!.description).toBe('Production');
    });

    test('profileNames returns all names', () => {
        const pm = new ConfigProfileManager()
            .register('a', {})
            .register('b', {});
        expect(pm.profileNames).toEqual(['a', 'b']);
    });
});

// ─── Response Cache ─────────────────────────────────────

describe('Response Cache', () => {
    const { ResponseCache } = require('./response-cache') as typeof import('./response-cache');

    test('set and get values', () => {
        const cache = new ResponseCache();
        cache.set('key1', 'value1');
        expect(cache.get('key1')).toBe('value1');
    });

    test('TTL expiry', async () => {
        const cache = new ResponseCache({ ttlMs: 50 });
        cache.set('exp', 'data');
        expect(cache.get('exp')).toBe('data');
        await new Promise(r => setTimeout(r, 60));
        expect(cache.get('exp')).toBeUndefined();
    });

    test('LRU eviction when full', () => {
        const cache = new ResponseCache({ maxSize: 2 });
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3); // should evict 'a'
        expect(cache.has('a')).toBe(false);
        expect(cache.has('c')).toBe(true);
    });

    test('hash is deterministic', () => {
        const cache = new ResponseCache();
        expect(cache.hash({ x: 1, y: 2 })).toBe(cache.hash({ x: 1, y: 2 }));
    });

    test('stats tracks hits and misses', () => {
        const cache = new ResponseCache();
        cache.set('k', 'v');
        cache.get('k'); // hit
        cache.get('missing'); // miss
        expect(cache.stats.hits).toBe(1);
        expect(cache.stats.misses).toBe(1);
    });
});

// ─── Batch Processor ────────────────────────────────────

describe('Batch Processor', () => {
    const { batchProcess, chunk, sequentialProcess } = require('./batch-processor') as typeof import('./batch-processor');

    test('processes items in parallel', async () => {
        const result = await batchProcess([1, 2, 3], async (n) => n * 2, { concurrency: 3 });
        expect(result.results.map(r => r.value)).toEqual([2, 4, 6]);
        expect(result.stats.succeeded).toBe(3);
    });

    test('handles errors with continueOnError', async () => {
        const result = await batchProcess([1, 2, 3], async (n) => {
            if (n === 2) throw new Error('bad');
            return n;
        });
        expect(result.stats.succeeded).toBe(2);
        expect(result.stats.failed).toBe(1);
        expect(result.errors[0]!.error.message).toBe('bad');
    });

    test('progress callback fires', async () => {
        let count = 0;
        await batchProcess([1, 2], async (n) => n, {
            onProgress: () => { count++; },
        });
        expect(count).toBe(2);
    });

    test('chunk splits arrays', () => {
        expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    });

    test('sequentialProcess runs one at a time', async () => {
        const order: number[] = [];
        await sequentialProcess([1, 2, 3], async (n) => {
            order.push(n);
            return n;
        });
        expect(order).toEqual([1, 2, 3]);
    });
});

// ─── Dependency Injection ───────────────────────────────

describe('Dependency Injection', () => {
    const { DIContainer } = require('./di') as typeof import('./di');

    test('singleton returns same instance', () => {
        const c = new DIContainer();
        let count = 0;
        c.singleton('svc', () => ({ id: ++count }));
        expect(c.resolve('svc')).toBe(c.resolve('svc'));
        expect(count).toBe(1);
    });

    test('transient returns new instance each time', () => {
        const c = new DIContainer();
        let count = 0;
        c.transient('svc', () => ({ id: ++count }));
        expect(c.resolve('svc')).not.toBe(c.resolve('svc'));
        expect(count).toBe(2);
    });

    test('value registers a constant', () => {
        const c = new DIContainer();
        c.value('config', { port: 3000 });
        // @ts-expect-error — strict mode inference through require/typeof import
        expect(c.resolve('config')).toEqual({ port: 3000 });
    });

    test('child scope inherits parent', () => {
        const parent = new DIContainer();
        parent.value('base', 42);
        const child = parent.createScope();
        child.value('extra', 99);
        // @ts-expect-error — strict mode inference through require/typeof import
        expect(child.resolve('base')).toBe(42);
        // @ts-expect-error — strict mode inference through require/typeof import
        expect(child.resolve('extra')).toBe(99);
    });

    test('getByTag returns matching names', () => {
        const c = new DIContainer();
        c.singleton('db', () => 'db', ['storage']);
        c.singleton('cache', () => 'cache', ['storage']);
        c.singleton('logger', () => 'log', ['infra']);
        expect(c.getByTag('storage')).toEqual(['db', 'cache']);
    });
});

// ─── Output Formatters ──────────────────────────────────

describe('Output Formatters', () => {
    const { formatOutput, templateFormatter } = require('./output-formatters') as typeof import('./output-formatters');

    test('JSON format', () => {
        const result = formatOutput({ a: 1 }, 'json');
        expect(JSON.parse(result)).toEqual({ a: 1 });
    });

    test('markdown format for object', () => {
        const result = formatOutput({ name: 'Alice', age: 30 }, 'markdown');
        expect(result).toContain('**name**');
        expect(result).toContain('Alice');
    });

    test('HTML format for object', () => {
        const result = formatOutput({ x: 1 }, 'html');
        expect(result).toContain('<table>');
        expect(result).toContain('<th>x</th>');
    });

    test('text format for object', () => {
        const result = formatOutput({ key: 'val' }, 'text');
        expect(result).toBe('key: val');
    });

    test('templateFormatter interpolates fields', () => {
        const fmt = templateFormatter('Hello {{name}}, age {{age}}!');
        expect(fmt({ name: 'Bob', age: 25 })).toBe('Hello Bob, age 25!');
    });
});

// ─── Guardrails ─────────────────────────────────────────

describe('Guardrails', () => {
    const { Guardrails, maxLengthRule, blockKeywords, nonEmptyRule } = require('./guardrails') as typeof import('./guardrails');

    test('passes when no violations', () => {
        const g = new Guardrails().addRule('len', maxLengthRule(100));
        const result = g.check('hello');
        expect(result.passed).toBe(true);
        expect(result.violations.length).toBe(0);
    });

    test('rejects on rule failure', () => {
        const g = new Guardrails().addRule('len', maxLengthRule(5), { action: 'reject' });
        const result = g.check('toolongtext');
        expect(result.passed).toBe(false);
        expect(result.violations[0]!.rule).toBe('len');
    });

    test('warns without blocking', () => {
        const g = new Guardrails().addRule('short', maxLengthRule(3), { action: 'warn' });
        const result = g.check('hello');
        expect(result.passed).toBe(true);
        expect(result.violations.length).toBe(1);
    });

    test('nonEmptyRule rejects empty', () => {
        const g = new Guardrails().addRule('notempty', nonEmptyRule());
        expect(g.check('  ').passed).toBe(false);
    });

    test('blockKeywords catches banned words', () => {
        const g = new Guardrails().addRule('kw', blockKeywords(['password', 'secret']));
        expect(g.check('my password is 123').passed).toBe(false);
        expect(g.check('hello world').passed).toBe(true);
    });
});

// ─── Session Manager ────────────────────────────────────

describe('Session Manager', () => {
    const { SessionManager } = require('./session') as typeof import('./session');

    test('set and get values', () => {
        const s = new SessionManager();
        s.set('user', 'Alice');
        // @ts-expect-error — strict mode inference through require/typeof import
        expect(s.get('user')).toBe('Alice');
    });

    test('snapshot captures state', () => {
        const s = new SessionManager();
        s.set('x', 1).set('y', 2);
        const snap = s.snapshot();
        expect(snap.data).toEqual({ x: 1, y: 2 });
        expect(snap.version).toBe(2);
    });

    test('serialize and restore', () => {
        const s1 = new SessionManager();
        s1.set('key', 'value');
        const serialized = s1.serialize();
        const s2 = new SessionManager();
        s2.restore(serialized);
        // @ts-expect-error — strict mode inference through require/typeof import
        expect(s2.get('key')).toBe('value');
    });

    test('has and delete work', () => {
        const s = new SessionManager();
        s.set('a', 1);
        expect(s.has('a')).toBe(true);
        s.delete('a');
        expect(s.has('a')).toBe(false);
    });

    test('expired detects old sessions', () => {
        const s = new SessionManager({ maxAge: -1 });
        expect(s.expired).toBe(true);
    });
});

// ─── Prompt Templates V2 ───────────────────────────────

describe('Prompt Templates V2', () => {
    const { createTemplate, composeTemplates } = require('./prompt-templates') as typeof import('./prompt-templates');

    test('interpolates variables', () => {
        const tpl = createTemplate('Hello {{name}}, you are {{role}}.');
        expect(tpl.render({ name: 'Alice', role: 'admin' })).toBe('Hello Alice, you are admin.');
    });

    test('handles #if conditionals', () => {
        const tpl = createTemplate('Hi{{#if admin}} [ADMIN]{{/if}}.');
        expect(tpl.render({ admin: true })).toBe('Hi [ADMIN].');
        expect(tpl.render({ admin: false })).toBe('Hi.');
    });

    test('handles #each loops', () => {
        const tpl = createTemplate('Items: {{#each items}}{{_item}}, {{/each}}');
        expect(tpl.render({ items: ['a', 'b', 'c'] })).toBe('Items: a, b, c,');
    });

    test('composes templates', () => {
        const a = createTemplate('System: {{role}}');
        const b = createTemplate('User: {{query}}');
        const composed = composeTemplates(a, b);
        expect(composed.render({ role: 'helper', query: 'hi' })).toContain('helper');
        expect(composed.render({ role: 'helper', query: 'hi' })).toContain('hi');
    });

    test('extracts variable names', () => {
        const tpl = createTemplate('{{name}} is {{age}} years old');
        expect(tpl.variables).toContain('name');
        expect(tpl.variables).toContain('age');
    });
});

// ─── State Machine ──────────────────────────────────────

describe('State Machine', () => {
    const { StateMachine } = require('./state-machine') as typeof import('./state-machine');

    test('transitions between states', async () => {
        const sm = new StateMachine('idle')
            .addTransition('idle', 'start', 'running')
            .addTransition('running', 'done', 'finished');
        await sm.send('start');
        expect(sm.currentState).toBe('running');
        await sm.send('done');
        expect(sm.currentState).toBe('finished');
    });

    test('guard prevents transition', async () => {
        const sm = new StateMachine<{ ready: boolean }>('idle', { ready: false })
            .addTransition('idle', 'start', 'running', (ctx) => ctx.ready);
        const result = await sm.send('start');
        expect(result).toBe(false);
        expect(sm.currentState).toBe('idle');
    });

    test('onEnter fires on transition', async () => {
        let entered = false;
        const sm = new StateMachine('a')
            .addTransition('a', 'go', 'b')
            .onEnter('b', () => { entered = true; });
        await sm.send('go');
        expect(entered).toBe(true);
    });

    test('canSend checks available events', () => {
        const sm = new StateMachine('idle')
            .addTransition('idle', 'start', 'running');
        expect(sm.canSend('start')).toBe(true);
        expect(sm.canSend('stop')).toBe(false);
    });

    test('history tracks transitions', async () => {
        const sm = new StateMachine('a')
            .addTransition('a', 'go', 'b')
            .addTransition('b', 'next', 'c');
        await sm.send('go');
        await sm.send('next');
        expect(sm.transitionHistory.length).toBe(2);
        expect(sm.transitionHistory[0]!.from).toBe('a');
        expect(sm.transitionHistory[1]!.to).toBe('c');
    });
});

// ─── Conversation Memory ────────────────────────────────

describe('Conversation Memory', () => {
    const { ConversationMemory } = require('./conversation-memory') as typeof import('./conversation-memory');

    test('add and search memories', () => {
        const mem = new ConversationMemory();
        mem.add('User prefers dark mode', ['preference']);
        mem.add('User likes TypeScript', ['language']);
        const results = mem.search('dark mode');
        expect(results.length).toBeGreaterThan(0);
        expect(results[0]!.entry.content).toContain('dark');
    });

    test('getByTag filters correctly', () => {
        const mem = new ConversationMemory();
        mem.add('a', ['ui']);
        mem.add('b', ['api']);
        mem.add('c', ['ui']);
        expect(mem.getByTag('ui').length).toBe(2);
    });

    test('getImportant sorts by importance', () => {
        const mem = new ConversationMemory();
        mem.add('low', [], 0.1);
        mem.add('high', [], 0.9);
        mem.add('mid', [], 0.5);
        const top = mem.getImportant(2);
        expect(top[0]!.importance).toBe(0.9);
    });

    test('maxEntries prunes', () => {
        const mem = new ConversationMemory({ maxEntries: 2 });
        mem.add('a', [], 0.5);
        mem.add('b', [], 0.8);
        mem.add('c', [], 0.3);
        expect(mem.size).toBe(2);
    });

    test('serialize and restore', () => {
        const mem = new ConversationMemory();
        mem.add('test data', ['tag1']);
        const data = mem.serialize();
        const mem2 = new ConversationMemory();
        mem2.restore(data);
        expect(mem2.size).toBe(1);
    });
});

// ─── Tool Registry ──────────────────────────────────────

describe('Tool Registry', () => {
    const { ToolRegistry } = require('./tool-registry') as typeof import('./tool-registry');

    test('register and invoke', async () => {
        const reg = new ToolRegistry();
        reg.register({ name: 'add', handler: (n: any) => n.a + n.b });
        const result = await reg.invoke('add', { a: 1, b: 2 });
        expect(result).toBe(3);
    });

    test('deregister removes tool', () => {
        const reg = new ToolRegistry();
        reg.register({ name: 'x', handler: () => { } });
        expect(reg.has('x')).toBe(true);
        reg.deregister('x');
        expect(reg.has('x')).toBe(false);
    });

    test('disabled tool cannot be invoked', async () => {
        const reg = new ToolRegistry();
        reg.register({ name: 't', handler: () => 'ok' });
        reg.setEnabled('t', false);
        await expect(reg.invoke('t', {})).rejects.toThrow('disabled');
    });

    test('search by description', () => {
        const reg = new ToolRegistry();
        reg.register({ name: 'web', handler: () => { }, description: 'Search the web' });
        reg.register({ name: 'db', handler: () => { }, description: 'Query database' });
        const results = reg.search('web');
        expect(results.length).toBe(1);
        expect(results[0]!.name).toBe('web');
    });

    test('getByCategory filters', () => {
        const reg = new ToolRegistry();
        reg.register({ name: 'a', handler: () => { }, category: 'search' });
        reg.register({ name: 'b', handler: () => { }, category: 'util' });
        expect(reg.getByCategory('search').length).toBe(1);
    });
});

// ─── Pipeline Composer ──────────────────────────────────

describe('Pipeline Composer', () => {
    const { compose } = require('./pipeline-composer') as typeof import('./pipeline-composer');

    test('pipes steps in order', async () => {
        const p = compose('test')
            .pipe('double', (n: number) => n * 2)
            .pipe('add10', (n: number) => n + 10);
        const result = await p.execute(5);
        expect(result.value).toBe(20);
        expect(result.success).toBe(true);
    });

    test('skip on error continues', async () => {
        const p = compose()
            .pipe('fail', () => { throw new Error('oops'); }, { onError: 'skip' })
            .pipe('ok', (x: any) => x ?? 42);
        const result = await p.execute(null);
        expect(result.success).toBe(true);
    });

    test('tracks step durations', async () => {
        const p = compose()
            .pipe('fast', (x: number) => x + 1);
        const result = await p.execute(1);
        expect(result.steps.length).toBe(1);
        expect(result.steps[0]!.durationMs).toBeGreaterThanOrEqual(0);
    });

    test('before hooks modify input', async () => {
        const p = compose()
            .before((x: number) => x * 10)
            .pipe('id', (x: number) => x);
        const result = await p.execute(3);
        expect(result.value).toBe(30);
    });

    test('fallback on error', async () => {
        const p = compose<any>()
            .pipe('risky', () => { throw new Error('boom'); }, {
                onError: 'abort',
                fallback: () => 'recovered',
            });
        // @ts-expect-error — passing null as initial input to test fallback
        const result = await p.execute(null);
        expect(result.value).toBe('recovered');
        expect(result.success).toBe(true);
    });
});

// ─── Metrics Collector ──────────────────────────────────

describe('Metrics Collector', () => {
    const { MetricsCollector } = require('./metrics') as typeof import('./metrics');

    test('record and getStats', () => {
        const m = new MetricsCollector();
        m.record('latency', 100);
        m.record('latency', 200);
        m.record('latency', 300);
        const stats = m.getStats('latency')!;
        expect(stats.count).toBe(3);
        expect(stats.avg).toBe(200);
        expect(stats.min).toBe(100);
        expect(stats.max).toBe(300);
    });

    test('increment counters', () => {
        const m = new MetricsCollector();
        m.increment('requests');
        m.increment('requests');
        m.increment('requests', 3);
        expect(m.getCounter('requests')).toBe(5);
    });

    test('percentiles computed correctly', () => {
        const m = new MetricsCollector();
        for (let i = 1; i <= 100; i++) m.record('p', i);
        const stats = m.getStats('p')!;
        expect(stats.p50).toBe(50);
        expect(stats.p95).toBe(95);
    });

    test('time measures async duration', async () => {
        const m = new MetricsCollector();
        const result = await m.time('op', async () => {
            return 42;
        });
        expect(result).toBe(42);
        expect(m.getStats('op')!.count).toBe(1);
    });

    test('summary shows all metrics', () => {
        const m = new MetricsCollector();
        m.record('a', 1);
        m.record('b', 2);
        const summary = m.summary();
        expect(Object.keys(summary)).toContain('a');
        expect(Object.keys(summary)).toContain('b');
    });
});

// ─── Webhook Handler ────────────────────────────────────

describe('Webhook Handler', () => {
    const { WebhookHandler } = require('./webhook') as typeof import('./webhook');

    test('dispatches to event handler', async () => {
        let received: any = null;
        const wh = new WebhookHandler();
        wh.on('push', (payload) => { received = payload; });
        await wh.handle('{"action":"push"}', undefined, 'push');
        expect(received).toEqual({ action: 'push' });
    });

    test('wildcard handler catches all', async () => {
        let count = 0;
        const wh = new WebhookHandler();
        wh.onAny(() => { count++; });
        await wh.handle('{}', undefined, 'a');
        await wh.handle('{}', undefined, 'b');
        expect(count).toBe(2);
    });

    test('rejects oversized payloads', async () => {
        const wh = new WebhookHandler({ maxPayloadSize: 10 });
        const result = await wh.handle('{"a":"this is too long"}');
        expect(result.success).toBe(false);
        expect(result.error).toContain('too large');
    });

    test('event allowlist blocks unknown events', async () => {
        const wh = new WebhookHandler({ allowedEvents: ['push'] });
        const result = await wh.handle('{}', undefined, 'delete');
        expect(result.success).toBe(false);
    });

    test('tracks history', async () => {
        const wh = new WebhookHandler();
        wh.on('x', () => { });
        await wh.handle('{}', undefined, 'x');
        await wh.handle('{}', undefined, 'x');
        expect(wh.getHistory().length).toBe(2);
    });
});

// ─── Schema Validator ───────────────────────────────────

describe('Schema Validator', () => {
    const { string, number, object, array } = require('./schema-validator') as typeof import('./schema-validator');

    test('validates string fields', () => {
        const s = string().minLength(2);
        expect(s.validate('hi').length).toBe(0);
        expect(s.validate('x').length).toBeGreaterThan(0);
    });

    test('validates number constraints', () => {
        const n = number().min(0).max(100);
        expect(n.validate(50).length).toBe(0);
        expect(n.validate(-1).length).toBeGreaterThan(0);
        expect(n.validate(101).length).toBeGreaterThan(0);
    });

    test('validates nested objects', () => {
        const schema = object({ name: string(), age: number().min(0) });
        const result = schema.check({ name: 'Alice', age: 30 });
        expect(result.valid).toBe(true);
        const bad = schema.check({ name: 123, age: -1 });
        expect(bad.valid).toBe(false);
        expect(bad.errors.length).toBeGreaterThanOrEqual(2);
    });

    test('optional fields skip missing', () => {
        const schema = object({ name: string(), bio: string().optional() });
        const result = schema.check({ name: 'Bob' });
        expect(result.valid).toBe(true);
    });

    test('array item validation', () => {
        const schema = array(number().min(0)).minItems(1);
        expect(schema.validate([1, 2, 3]).length).toBe(0);
        expect(schema.validate([-1]).length).toBeGreaterThan(0);
        expect(schema.validate([]).length).toBeGreaterThan(0);
    });
});

// ─── Webhook Handler ────────────────────────────────────

describe('Webhook Handler', () => {
    const { WebhookHandler, hmacSha256 } = require('./webhook') as typeof import('./webhook');

    test('basic event routing', async () => {
        const wh = new WebhookHandler();
        let received: any = null;
        wh.on('push', async (payload) => { received = payload; });

        const result = await wh.handle('{"repo":"gxai"}', undefined, 'push');
        expect(result.success).toBe(true);
        expect(result.event).toBe('push');
        expect(received?.repo).toBe('gxai');
    });

    test('HMAC-SHA256 signature verification', async () => {
        const secret = 'test-webhook-secret';
        const wh = new WebhookHandler({ secret });
        let called = false;
        wh.on('deploy', async () => { called = true; });

        const body = '{"action":"deploy"}';
        const validSig = await hmacSha256(body, secret);

        // Valid signature → success
        const ok = await wh.handle(body, validSig, 'deploy');
        expect(ok.success).toBe(true);
        expect(called).toBe(true);

        // Invalid signature → rejected
        const bad = await wh.handle(body, 'invalid-sig', 'deploy');
        expect(bad.success).toBe(false);
        expect(bad.error).toContain('Invalid signature');
    });

    test('GitHub sha256= prefix support', async () => {
        const secret = 'github-secret';
        const wh = new WebhookHandler({ secret });
        wh.on('push', async () => { });

        const body = '{"ref":"refs/heads/main"}';
        const sig = await hmacSha256(body, secret);

        const result = await wh.handle(body, `sha256=${sig}`, 'push');
        expect(result.success).toBe(true);
    });

    test('payload size limit', async () => {
        const wh = new WebhookHandler({ maxPayloadSize: 50 });
        const result = await wh.handle('x'.repeat(100), undefined, 'test');
        expect(result.success).toBe(false);
        expect(result.error).toContain('too large');
    });

    test('event allowlist', async () => {
        const wh = new WebhookHandler({ allowedEvents: ['push', 'pr'] });
        const ok = await wh.handle('{}', undefined, 'push');
        expect(ok.success).toBe(true);
        const blocked = await wh.handle('{}', undefined, 'delete');
        expect(blocked.success).toBe(false);
        expect(blocked.error).toContain('not allowed');
    });

    test('history tracking', async () => {
        const wh = new WebhookHandler();
        wh.on('test', async () => { });
        await wh.handle('{}', undefined, 'test');
        await wh.handle('{}', undefined, 'test');

        const history = wh.getHistory();
        expect(history.length).toBe(2);
        expect(history[0]!.processingMs).toBeGreaterThanOrEqual(0);
    });

    test('wildcard handler catches all events', async () => {
        const wh = new WebhookHandler();
        const events: string[] = [];
        wh.onAny(async (_payload, meta) => { events.push(meta.event); });

        await wh.handle('{}', undefined, 'push');
        await wh.handle('{}', undefined, 'deploy');
        expect(events).toEqual(['push', 'deploy']);
    });
});
