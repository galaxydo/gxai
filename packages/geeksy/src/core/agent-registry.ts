/**
 * Agent Registry - Manages agent definitions and lifecycle
 * 
 * Agents can:
 * - Handle messages (process them)
 * - Ignore messages (skip processing)
 * - Spawn new agents (generate code and start new bgr processes)
 * - Respond (send a response back to the user)
 */

import { $ } from 'bun';
import { getDatabase, generateId, stringifyJSON, parseJSON } from './database';

export type AgentAction = 'handle' | 'ignore' | 'spawn' | 'respond';

export interface AgentDefinition {
    id: string;
    name: string;
    description: string;
    emoji: string;
    port: number;
    scriptPath: string;           // Path to the agent script
    capabilities: AgentAction[];  // What actions this agent can perform
    running: boolean;
    pid?: number;
    lastActivity?: number;
}

export interface AgentDecision {
    id: string;
    agentId: string;
    messageId: string;
    action: AgentAction;
    data?: any;
    timestamp: number;
}

export class AgentRegistry {
    private healthCheckInterval?: Timer;

    constructor() { }

    /** Register a new agent definition */
    register(agent: Omit<AgentDefinition, 'running' | 'pid' | 'lastActivity'>): AgentDefinition {
        const db = getDatabase();
        const existing = db.agents.findOne({ agentId: agent.id });

        if (existing) {
            db.agents.update({ agentId: agent.id }, {
                name: agent.name,
                description: agent.description,
                emoji: agent.emoji,
                port: agent.port,
                scriptPath: agent.scriptPath,
                capabilities: stringifyJSON(agent.capabilities),
                running: false,
            });
            return { ...agent, running: false };
        }

        db.agents.insert({
            agentId: agent.id,
            name: agent.name,
            description: agent.description,
            emoji: agent.emoji,
            port: agent.port,
            scriptPath: agent.scriptPath,
            capabilities: stringifyJSON(agent.capabilities),
            running: false,
        });

        return { ...agent, running: false };
    }

    /** Get all registered agents */
    getAll(): AgentDefinition[] {
        const db = getDatabase();
        const rows = db.agents.find();
        return rows.map(row => this.rowToAgent(row));
    }

    /** Get all registered agents (sync for SSR - same since SatiDB is sync) */
    getAllSync(): AgentDefinition[] {
        return this.getAll();
    }

    /** Get running agents */
    getRunning(): AgentDefinition[] {
        const db = getDatabase();
        const rows = db.agents.find({ running: true });
        return rows.map(row => this.rowToAgent(row));
    }

    /** Get agent by ID */
    getById(agentId: string): AgentDefinition | null {
        const db = getDatabase();
        const row = db.agents.findOne({ agentId });
        return row ? this.rowToAgent(row) : null;
    }

    /** Start an agent using bgr */
    async start(agentId: string): Promise<{ success: boolean; message: string }> {
        const agent = this.getById(agentId);
        if (!agent) {
            return { success: false, message: `Agent ${agentId} not found` };
        }

        try {
            const cwd = process.cwd();
            await $`bgr --name ${agent.id} --command "bun run ${agent.scriptPath}" --directory ${cwd} --force`.quiet();

            // Wait for agent to be ready
            for (let i = 0; i < 10; i++) {
                await new Promise(r => setTimeout(r, 500));
                try {
                    const response = await fetch(`http://localhost:${agent.port}/health`);
                    if (response.ok) {
                        const db = getDatabase();
                        db.agents.update({ agentId }, { running: true, lastActivity: Date.now() });
                        return { success: true, message: `Started ${agent.name} on port ${agent.port}` };
                    }
                } catch { }
            }

            return { success: true, message: `Started ${agent.name}, waiting for ready...` };
        } catch (e) {
            return { success: false, message: e instanceof Error ? e.message : 'Failed to start agent' };
        }
    }

    /** Mark an agent as running (for inline/embedded agents without separate processes) */
    setRunning(agentId: string, running: boolean = true): void {
        const db = getDatabase();
        db.agents.update({ agentId }, { running, lastActivity: Date.now() });
    }

    /** Stop an agent */
    async stop(agentId: string): Promise<{ success: boolean; message: string }> {
        const agent = this.getById(agentId);
        if (!agent) {
            return { success: false, message: `Agent ${agentId} not found` };
        }

        try {
            await $`bgr --delete ${agent.id}`.quiet();
            const db = getDatabase();
            db.agents.update({ agentId }, { running: false, pid: undefined });
            return { success: true, message: `Stopped ${agent.name}` };
        } catch (e) {
            return { success: false, message: e instanceof Error ? e.message : 'Failed to stop agent' };
        }
    }

    /** Record an agent's decision about a message */
    recordDecision(agentId: string, messageId: string, action: AgentAction, data?: any): void {
        const db = getDatabase();

        // Create a job record for the decision
        db.jobs.insert({
            jobId: generateId('job'),
            messageId,
            agentId,
            agentName: this.getById(agentId)?.name || agentId,
            agentEmoji: this.getById(agentId)?.emoji || '🤖',
            status: 'pending',
            decision: action,
            reason: data?.reason || 'Agent decision',
            result: data?.result ? stringifyJSON(data.result) : undefined,
            startedAt: Date.now(),
            logs: stringifyJSON([{ timestamp: Date.now(), level: 'info', message: `Decision: ${action}` }]),
        });

        db.agents.update({ agentId }, { lastActivity: Date.now() });
    }

    /** Get decisions for a message */
    getDecisions(messageId: string): AgentDecision[] {
        const db = getDatabase();
        const jobs = db.jobs.find({ messageId });

        return jobs.map(job => ({
            id: job.jobId,
            agentId: job.agentId,
            messageId: job.messageId,
            action: job.decision as AgentAction,
            data: job.result ? parseJSON(job.result, null) : undefined,
            timestamp: job.startedAt,
        }));
    }

    /** Check health of all agents */
    async checkHealth(): Promise<void> {
        const agents = this.getAll();
        const db = getDatabase();

        for (const agent of agents) {
            try {
                const response = await fetch(`http://localhost:${agent.port}/health`);
                const isRunning = response.ok;
                if (agent.running !== isRunning) {
                    db.agents.update({ agentId: agent.id }, { running: isRunning });
                }
            } catch {
                if (agent.running) {
                    db.agents.update({ agentId: agent.id }, { running: false });
                }
            }
        }
    }

    /** Start periodic health checks */
    startHealthChecks(intervalMs: number = 5000): void {
        this.healthCheckInterval = setInterval(() => this.checkHealth(), intervalMs);
    }

    /** Stop health checks */
    stopHealthChecks(): void {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }
    }

    /** Spawn a new agent from generated code */
    async spawn(
        name: string,
        code: string,
        port: number,
        options?: { description?: string; emoji?: string }
    ): Promise<AgentDefinition> {
        const id = name.toLowerCase().replace(/\s+/g, '-');
        const scriptPath = `.geeksy/spawned/${id}.ts`;

        // Write the generated code to a file
        await Bun.write(scriptPath, code);

        // Register the new agent
        const agent = this.register({
            id,
            name,
            description: options?.description || `Spawned agent: ${name}`,
            emoji: options?.emoji || '🤖',
            port,
            scriptPath,
            capabilities: ['handle', 'respond']
        });

        // Start the agent
        await this.start(id);

        return agent;
    }

    /** Convert DB row to AgentDefinition */
    private rowToAgent(row: any): AgentDefinition {
        return {
            id: row.agentId,
            name: row.name,
            description: row.description,
            emoji: row.emoji,
            port: row.port,
            scriptPath: row.scriptPath,
            capabilities: parseJSON(row.capabilities, ['handle', 'respond']),
            running: row.running,
            pid: row.pid,
            lastActivity: row.lastActivity,
        };
    }
}
