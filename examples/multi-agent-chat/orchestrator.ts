/**
 * Multi-Agent Orchestrator Server
 * Manages agent processes and coordinates requests
 */
import { $ } from 'bun';

// Agent configurations
const AGENTS = [
    { name: 'summarizer', port: 4001, emoji: '📝', description: 'Summarizes content' },
    { name: 'translator', port: 4002, emoji: '🌍', description: 'Translates to multiple languages' },
    { name: 'analyst', port: 4003, emoji: '📊', description: 'Provides analysis and insights' },
    { name: 'creative', port: 4004, emoji: '🎨', description: 'Generates creative content' },
];

const EXAMPLE_DIR = import.meta.dir;

interface AgentStatus {
    name: string;
    port: number;
    emoji: string;
    description: string;
    running: boolean;
    pid?: number;
}

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    agentResults?: Record<string, any>;
    timestamp: number;
}

// In-memory chat history
const chatHistory: ChatMessage[] = [];

// Check if an agent is running via health endpoint
async function checkAgentHealth(port: number): Promise<boolean> {
    try {
        const res = await fetch(`http://localhost:${port}/health`, {
            signal: AbortSignal.timeout(1000),
        });
        return res.ok;
    } catch {
        return false;
    }
}

// Get status of all agents
async function getAgentStatuses(): Promise<AgentStatus[]> {
    const statuses = await Promise.all(
        AGENTS.map(async (agent) => {
            const running = await checkAgentHealth(agent.port);
            let pid: number | undefined;

            // Try to get PID from bgr
            try {
                const result = await $`bgr ${agent.name} --json`.quiet();
                const data = JSON.parse(result.text());
                pid = data.pid;
            } catch { }

            return {
                ...agent,
                running,
                pid,
            };
        })
    );
    return statuses;
}

// Start an agent via bgr
async function startAgent(name: string): Promise<{ success: boolean; message: string }> {
    const agent = AGENTS.find(a => a.name === name);
    if (!agent) {
        return { success: false, message: `Unknown agent: ${name}` };
    }

    try {
        // Use the gxai root directory (parent of examples/multi-agent-chat)
        const gxaiRoot = EXAMPLE_DIR.replace('/examples/multi-agent-chat', '');
        const agentPath = `examples/multi-agent-chat/agents/${name}.ts`;
        await $`bgr --name ${name} --command "bun run ${agentPath}" --directory ${gxaiRoot} --force`.quiet();

        // Wait for agent to be healthy
        for (let i = 0; i < 10; i++) {
            await Bun.sleep(500);
            if (await checkAgentHealth(agent.port)) {
                return { success: true, message: `Started ${name} on port ${agent.port}` };
            }
        }
        return { success: true, message: `Started ${name}, waiting for ready...` };
    } catch (e) {
        return { success: false, message: e instanceof Error ? e.message : 'Failed to start' };
    }
}

// Stop an agent via bgr
async function stopAgent(name: string): Promise<{ success: boolean; message: string }> {
    try {
        await $`bgr --delete ${name}`.quiet();
        return { success: true, message: `Stopped ${name}` };
    } catch (e) {
        return { success: false, message: e instanceof Error ? e.message : 'Failed to stop' };
    }
}

// Send prompt to all running agents
async function processPrompt(prompt: string): Promise<Record<string, any>> {
    const statuses = await getAgentStatuses();
    const runningAgents = statuses.filter(a => a.running);

    if (runningAgents.length === 0) {
        return { error: 'No agents are running. Start at least one agent.' };
    }

    const results: Record<string, any> = {};

    await Promise.all(
        runningAgents.map(async (agent) => {
            try {
                const res = await fetch(`http://localhost:${agent.port}/process`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt }),
                    signal: AbortSignal.timeout(30000),
                });
                const data = await res.json();
                results[agent.name] = {
                    emoji: agent.emoji,
                    ...data,
                };
            } catch (e) {
                results[agent.name] = {
                    emoji: agent.emoji,
                    error: e instanceof Error ? e.message : 'Failed to process',
                };
            }
        })
    );

    return results;
}

// Export functions for API routes
export { getAgentStatuses, startAgent, stopAgent, processPrompt, chatHistory, AGENTS };
export type { AgentStatus, ChatMessage };
