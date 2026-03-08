import { Agent } from './agent';
import type { AgentConfig, MCPServer } from './types';

export interface MockSequenceItem {
    /** Pattern to match against the user prompt or tool input */
    matchPrompt?: RegExp | string;
    /** Output JSON to return to the agent */
    output: Record<string, any>;
    /** Optional simulated latency in milliseconds */
    delayMs?: number;
    /** Optional tool callbacks that occur before output generation */
    simulateTools?: Array<{
        tool: string;
        server: string;
        result: any;
    }>;
}

export interface AgentMockConfig {
    /** Preload a sequence of mock outputs. The engine consumes them in order. */
    sequence?: MockSequenceItem[];
    /** Allow the agent to hit real LLMs if no mock sequence matches? (Default false) */
    allowPassthrough?: boolean;
}

/**
 * Deterministic Mock Engine for Testing Agents.
 * Wraps an existing Agent to short-circuit the LLM network boundary and instantly
 * yield predefined structured responses for test environments.
 */
export class AgentMock {
    private agent: Agent<any, any>;
    private sequence: MockSequenceItem[];
    private passthrough: boolean;
    private cursor: number = 0;

    constructor(agent: Agent<any, any>, config: AgentMockConfig = {}) {
        this.agent = agent;
        this.sequence = config.sequence || [];
        this.passthrough = config.allowPassthrough ?? false;

        // Intercept middleware to stub the LLM call before it fires
        this.agent.use(async (ctx: any) => {
            if (ctx.phase !== 'before') return;
            const inputStr = typeof ctx.input === 'string' ? ctx.input : JSON.stringify(ctx.input);
            const item = this.matchNextItem(inputStr);

            if (item) {
                await this.executeSimulations(item);
                if (item.delayMs) {
                    await new Promise(r => setTimeout(r, item.delayMs));
                }

                // Throw a control-flow exception containing the mocked result
                // to gracefully abort the real LLM HTTP Request.
                throw new MockAbortedExecution(item.output);
            } else if (!this.passthrough) {
                throw new Error(`AgentMock Error: No matching mock sequence for input and passthrough is disabled.`);
            }
        });
    }

    private matchNextItem(input: string): MockSequenceItem | null {
        if (this.cursor >= this.sequence.length) return null;

        const candidate = this.sequence[this.cursor];
        if (!candidate) return null;

        if (candidate.matchPrompt) {
            const isMatch = candidate.matchPrompt instanceof RegExp
                ? candidate.matchPrompt.test(input)
                : input.includes(candidate.matchPrompt);
            if (!isMatch) return null;
        }

        this.cursor++;
        return candidate;
    }

    private async executeSimulations(item: MockSequenceItem) {
        if (!item.simulateTools) return;

        for (const sim of item.simulateTools) {
            // Find the configured MCP Server
            const config = (this.agent as any).config as AgentConfig<any, any>;
            const server = config.servers?.find((s: MCPServer) => s.name === sim.server);
            if (!server) continue;

            // In a real test we might just emit the events simulating the tool call
            try {
                // @ts-ignore - reaching into internals for simulation tracking
                this.agent.emitEvent({
                    type: 'tool_complete',
                    agentName: config.name || 'mock-agent',
                    timestamp: Date.now(),
                    tool: sim.tool,
                    server: sim.server,
                    durationMs: 10,
                    success: true
                });
            } catch (e) { }
        }
    }

    /** Add more mocked outputs dynamically during a test */
    public addMockResult(item: MockSequenceItem) {
        this.sequence.push(item);
    }

    /** Reset sequence cursor back to start */
    public reset() {
        this.cursor = 0;
    }

    /** Verify all mocked items were consumed */
    public isExhausted(): boolean {
        return this.cursor >= this.sequence.length;
    }
}

/** Internal Control Flow Exception used to short-circuit Agent.run() */
class MockAbortedExecution extends Error {
    public mockedOutput: any;
    constructor(output: any) {
        super("MOCK_ABORT");
        this.mockedOutput = output;
        this.name = "MockAbortedExecution";
    }
}
