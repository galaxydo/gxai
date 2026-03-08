import { test, expect, describe, afterEach, beforeEach, jest } from 'bun:test';
import { Agent } from '../src/agent';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

describe('Agent Analytics', () => {
    const queueDir = path.join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.gxai');
    const queueFile = path.join(queueDir, 'analytics_queue.json');

    beforeEach(() => {
        if (fs.existsSync(queueFile)) {
            fs.unlinkSync(queueFile);
        }
    });

    afterEach(() => {
        if (fs.existsSync(queueFile)) {
            fs.unlinkSync(queueFile);
        }
    });

    test('should queue analytics on failure and retry on next success', async () => {
        let fetchCount = 0;
        let interceptedPayloads: any[] = [];

        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
            if (url === 'http://test-analytics.app') {
                fetchCount++;
                const payload = JSON.parse(init?.body as string || '{}');
                interceptedPayloads.push(payload);

                // Fail the first time to trigger queue
                if (fetchCount === 1) {
                    throw new Error('Network offline');
                }

                // Succeed the next times
                return new Response('ok', { status: 200 });
            }
            // Mock LLM request to just return empty response for the agent
            return new Response(JSON.stringify({ choices: [{ message: { content: '<output>{"test": "ok"}</output>' } }] }), { status: 200 });
        }) as any;

        const agent = new Agent({
            llm: 'gpt-4o-mini',
            analyticsUrl: 'http://test-analytics.app',
            name: 'test-agent',
            inputFormat: z.object({}),
            outputFormat: z.object({ test: z.string() })
        });

        try {
            // First run - analytics fetch will fail and it should queue it
            await agent.run({});

            // Wait for queue logic to settle (it's inside catch)
            await new Promise(r => setTimeout(r, 100));

            expect(fs.existsSync(queueFile)).toBe(true);
            const queueContents = JSON.parse(fs.readFileSync(queueFile, 'utf-8'));
            expect(queueContents.length).toBe(1);
            expect(queueContents[0].agentName).toBe('test-agent');

            // Second run - analytics fetch will succeed for this run, AND it should flush the queue
            await agent.run({});

            // Wait for flush to finish
            await new Promise(r => setTimeout(r, 100));

            // The queue file should be updated (empty or having only the ones that failed)
            const updatedQueue = JSON.parse(fs.readFileSync(queueFile, 'utf-8'));
            expect(updatedQueue.length).toBe(0);

            // We expect fetch to have been called 3 times total:
            // 1. First run (fails)
            // 2. Second run (succeeds)
            // 3. Flush queue background job for the first item (succeeds)
            expect(fetchCount).toBe(3);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
