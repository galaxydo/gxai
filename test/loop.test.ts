import { test, expect, describe, afterEach, beforeEach } from 'bun:test';
import { LoopAgent, LoopEvent } from '../src/loop';
import * as fs from 'fs';
import * as path from 'path';

describe('LoopAgent Tests', () => {
    const testDir = path.join(process.cwd(), 'test-data-loop');

    beforeEach(() => {
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true });
        }
    });

    afterEach(() => {
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    test('should execute tools and reach outcomes', async () => {
        let fetchCount = 0;
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () => {
            fetchCount++;
            let content = '';
            if (fetchCount === 1) {
                // First iteration: use write_file tool
                content = `<tool_call>
{"tool": "write_file", "params": {"path": "test-data-loop/hello.txt", "content": "world"}}
</tool_call>`;
            } else if (fetchCount === 2) {
                // Second iteration: use read_file tool
                content = `<tool_call>
{"tool": "read_file", "params": {"path": "test-data-loop/hello.txt"}}
</tool_call>`;
            } else {
                // Third iteration: do nothing and let it finish
                content = `Done!`;
            }
            return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
        }) as any;

        try {
            const agent = new LoopAgent({
                llm: 'gpt-4o-mini',
                maxIterations: 5,
                cwd: process.cwd(),
                outcomes: [
                    {
                        description: 'hello.txt has been written and read',
                        validate: async () => {
                            const exists = fs.existsSync(path.join(testDir, 'hello.txt'));
                            return { met: exists && fetchCount >= 2, reason: exists ? 'File exists' : 'Not found' };
                        }
                    }
                ]
            });

            const events: LoopEvent[] = [];
            const result = await agent.execute('Create hello.txt and read it', (e) => events.push(e));

            expect(result.success).toBe(true);
            expect(result.iterations).toBe(2);
            expect(events.filter(e => e.type === 'tool_start').length).toBe(2);
            expect(events.find(e => e.type === 'tool_start' && (e as any).tool === 'write_file')).toBeDefined();
            expect(events.find(e => e.type === 'tool_start' && (e as any).tool === 'read_file')).toBeDefined();
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('should execute shell commands', async () => {
        let fetchCount = 0;
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () => {
            fetchCount++;
            let content = '';
            if (fetchCount === 1) {
                // Write a script and run it via exec
                content = `<tool_call>
{"tool": "exec", "params": {"command": "echo hello"}}
</tool_call>`;
            } else {
                content = `Done!`;
            }
            return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
        }) as any;

        try {
            const agent = new LoopAgent({
                llm: 'gpt-4o-mini',
                maxIterations: 3,
                cwd: process.cwd(),
                outcomes: [
                    {
                        description: 'Executed echo command',
                        validate: async (state) => {
                            const hasExec = state.toolHistory.some(t => t.tool === 'exec' && t.result?.success);
                            return { met: hasExec, reason: hasExec ? 'Command executed' : 'Not executed' };
                        }
                    }
                ]
            });

            const events: LoopEvent[] = [];
            const result = await agent.execute('Run a command', (e) => events.push(e));

            expect(result.success).toBe(true);
            expect(result.iterations).toBe(1);
            expect(events.filter(e => e.type === 'tool_start').length).toBe(1);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('should handle max iterations reached', async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () => {
            // Keep producing no-op responses that do not meet the outcome
            return new Response(JSON.stringify({ choices: [{ message: { content: 'Nothing to do' } }] }));
        }) as any;

        try {
            const agent = new LoopAgent({
                llm: 'gpt-4o-mini',
                maxIterations: 2,
                outcomes: [
                    {
                        description: 'Impossible outcome',
                        validate: async () => ({ met: false, reason: 'Never met' })
                    }
                ]
            });

            const result = await agent.execute('Do something');

            expect(result.success).toBe(false);
            expect(result.iterations).toBe(2);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
