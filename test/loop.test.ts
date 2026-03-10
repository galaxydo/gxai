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

// ─── LoopAgent Session Persistence ──────────────────────

describe('LoopAgent Session Persistence', () => {
    /** Minimal SessionManager mock */
    function createMockSession() {
        const store = new Map<string, any>();
        return {
            store,
            set(key: string, value: any) { store.set(key, value); },
            get(key: string) { return store.get(key); },
            load() { /* no-op for in-memory mock */ },
            save() { /* no-op for in-memory mock */ },
        };
    }

    const baseConfig = {
        llm: 'gpt-4o-mini' as const,
        maxIterations: 3,
        outcomes: [
            {
                description: 'Always met',
                validate: async () => ({ met: true, reason: 'always' }),
            },
        ],
    };

    test('fromSession() restores state from session', () => {
        const session = createMockSession();
        session.set('loopState', {
            iteration: 2,
            toolHistory: [{ tool: 'exec', params: { command: 'echo hi' } }],
            outcomeResults: [],
        });

        const agent = LoopAgent.fromSession(session, baseConfig);
        expect(agent).not.toBeNull();
        expect(agent!.state.iteration).toBe(2);
        expect(agent!.state.toolHistory.length).toBe(1);
    });

    test('fromSession() returns null when no saved state', () => {
        const session = createMockSession();
        expect(LoopAgent.fromSession(session, baseConfig)).toBeNull();
    });

    test('session checkpoint is saved after each iteration', async () => {
        const session = createMockSession();
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () => {
            return new Response(JSON.stringify({ choices: [{ message: { content: 'Done' } }] }));
        }) as any;

        try {
            const agent = new LoopAgent({ ...baseConfig, session });
            await agent.execute('test task');

            // After completion, session should have completedAt (from removeCheckpoint)
            expect(session.get('completedAt')).toBeDefined();
            expect(typeof session.get('completedAt')).toBe('number');
            // loopState should be cleared on success
            expect(session.get('loopState')).toBeNull();
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('session checkpoint persists state during execution', async () => {
        const session = createMockSession();
        let fetchCount = 0;
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () => {
            fetchCount++;
            const content = fetchCount === 1
                ? '<tool_call>\n{"tool": "exec", "params": {"command": "echo hi"}}\n</tool_call>'
                : 'Done!';
            return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
        }) as any;

        try {
            const neverMetConfig = {
                ...baseConfig,
                maxIterations: 2,
                outcomes: [
                    {
                        description: 'Never met',
                        validate: async () => ({ met: false, reason: 'always false' }),
                    },
                ],
            };

            const agent = new LoopAgent({ ...neverMetConfig, session });
            await agent.execute('test task');

            // After max iterations, loopState should be saved (not cleared since it didn't succeed)
            const savedState = session.get('loopState');
            expect(savedState).toBeDefined();
            expect(savedState.iteration).toBe(1); // last iteration index
            expect(session.get('lastCheckpointAt')).toBeDefined();
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
