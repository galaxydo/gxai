/**
 * Geeksy Orchestrator - Routes messages between Admin, Agents, and Jobs
 * 
 * Architecture:
 * 
 * 1. ADMIN MESSAGES:
 *    Admin/Owner → Orchestrator → Selects Agent → Agent processes command
 *    Example: "Create a bot that responds to 'hello' with 'hi there!'"
 *    
 * 2. REGULAR MESSAGES:
 *    User Message → Jobs (filter matching) → Execute action → Respond
 *    Example: User says "hello" → HelloJob triggers → Sends "hi there!"
 * 
 * Agents are meta-level: they CREATE and MANAGE jobs
 * Jobs are runtime-level: they LISTEN and RESPOND to messages
 */

import type { MessageData } from './message-bus';

// ============================================
// Types
// ============================================

/** Filter definition for a job - determines which messages trigger it */
export interface JobFilter {
    /** Match messages from specific user */
    fromUser?: string;
    /** Match messages containing any of these words */
    containsWords?: string[];
    /** Match messages from specific source/channel */
    fromSource?: string;
    /** Match all messages (catch-all) */
    matchAll?: boolean;
    /** Custom filter function (serialized for storage) */
    customFilter?: string;
}

/** Action a job can take when triggered */
export interface JobAction {
    /** Type of action */
    type: 'respond' | 'forward' | 'update' | 'execute' | 'spawn-agent';
    /** Response content (for 'respond' type) */
    responseContent?: string;
    /** Target user/channel (for 'forward' type) */
    targetUser?: string;
    targetChannel?: string;
    /** Code to execute (for 'execute' type) */
    executeCode?: string;
    /** Agent to spawn (for 'spawn-agent' type) */
    spawnAgentId?: string;
    spawnAgentArgs?: Record<string, any>;
}

/** A persistent job that listens for messages */
export interface PersistentJob {
    id: string;
    name: string;
    description: string;
    emoji: string;
    /** The agent that created this job */
    createdByAgentId: string;
    /** Filter to match incoming messages */
    filter: JobFilter;
    /** Action to take when triggered */
    action: JobAction;
    /** Is this job currently active? */
    active: boolean;
    /** Stats */
    triggerCount: number;
    lastTriggeredAt?: number;
    createdAt: number;
}

/** Agent definition with matching capabilities */
export interface AgentDefinition {
    id: string;
    name: string;
    emoji: string;
    description: string;
    /** What kind of commands this agent handles */
    capabilities: string[];
    /** Keywords that help match this agent to commands */
    keywords: string[];
    /** Is the agent running? */
    running: boolean;
}

/** Result from agent processing a command */
export interface AgentProcessResult {
    success: boolean;
    message: string;
    /** Jobs created by this agent */
    createdJobs?: PersistentJob[];
    /** Response to send back to admin */
    adminResponse?: string;
}

/** Result from job execution */
export interface JobExecutionResult {
    success: boolean;
    message: string;
    /** Response sent to user */
    responseSent?: string;
    /** Updated message content */
    updatedMessage?: string;
}

// ============================================
// Orchestrator
// ============================================

export class Orchestrator {
    private agents: Map<string, AgentDefinition> = new Map();
    private jobs: Map<string, PersistentJob> = new Map();
    private adminUserIds: Set<string> = new Set();
    private agentHandlers: Map<string, (message: MessageData, args: any) => Promise<AgentProcessResult>> = new Map();

    constructor(
        private messageBus: { subscribe: (id: string, handler: (msg: MessageData) => void) => void },
        private activityLogger: { log: (event: any) => void },
        private responseChannel: { send: (agentId: string, agentName: string, messageId: string, content: string, target: any) => void },
    ) { }

    // ============================================
    // Setup
    // ============================================

    /** Register an admin user who can give commands to agents */
    registerAdmin(userId: string): void {
        this.adminUserIds.add(userId);
        console.log(`👑 Registered admin: ${userId}`);
    }

    /** Register an agent that can process commands */
    registerAgent(agent: AgentDefinition, handler: (message: MessageData, args: any) => Promise<AgentProcessResult>): void {
        this.agents.set(agent.id, agent);
        this.agentHandlers.set(agent.id, handler);
        console.log(`🤖 Registered agent: ${agent.emoji} ${agent.name}`);
    }

    /** Register a persistent job */
    registerJob(job: PersistentJob): void {
        this.jobs.set(job.id, job);
        console.log(`📋 Registered job: ${job.emoji} ${job.name}`);
    }

    /** Start listening for messages */
    start(): void {
        console.log('🎯 Orchestrator starting...');
        console.log(`   → ${this.agents.size} agents registered`);
        console.log(`   → ${this.jobs.size} jobs registered`);
        console.log(`   → ${this.adminUserIds.size} admins registered`);

        this.messageBus.subscribe('orchestrator', async (message) => {
            await this.processMessage(message);
        });

        console.log('🎯 Orchestrator running, listening for messages...');
    }

    // ============================================
    // Message Processing
    // ============================================

    /** Process an incoming message */
    private async processMessage(message: MessageData): Promise<void> {
        const isAdmin = this.isAdminMessage(message);

        console.log(`\n📬 Message received: "${message.content.slice(0, 50)}..."`);
        console.log(`   From: ${message.userId || 'unknown'} | Admin: ${isAdmin}`);

        if (isAdmin) {
            // Admin message - route to appropriate agent
            await this.processAdminCommand(message);
        } else {
            // Regular message - check against job filters
            await this.processWithJobs(message);
        }
    }

    /** Check if message is from an admin */
    private isAdminMessage(message: MessageData): boolean {
        if (!message.userId) return false;
        return this.adminUserIds.has(message.userId);
    }

    // ============================================
    // Admin Command Processing
    // ============================================

    /** Process a command from admin - select agent and pass command */
    private async processAdminCommand(message: MessageData): Promise<void> {
        console.log(`👑 Processing admin command...`);

        // Find best matching agent based on message content
        const agent = this.findBestAgent(message.content);

        if (!agent) {
            console.log(`   ❌ No suitable agent found for this command`);
            this.respondToAdmin(message, "I couldn't find an agent to handle this request. Try being more specific about what you want.");
            return;
        }

        console.log(`   → Selected agent: ${agent.emoji} ${agent.name}`);

        // Get agent handler
        const handler = this.agentHandlers.get(agent.id);
        if (!handler) {
            console.log(`   ❌ Agent has no handler`);
            return;
        }

        // Log activity
        this.activityLogger.log({
            agentId: agent.id,
            agentName: agent.name,
            agentEmoji: agent.emoji,
            action: 'info',
            summary: `Processing admin command: ${message.content.slice(0, 50)}...`,
            messageId: message.id,
        });

        try {
            // Execute agent handler
            const result = await handler(message, { isAdmin: true });

            // Register any created jobs
            if (result.createdJobs) {
                for (const job of result.createdJobs) {
                    this.registerJob(job);
                }
            }

            // Send response to admin
            if (result.adminResponse) {
                this.respondToAdmin(message, result.adminResponse);
            }

            // Log completion
            this.activityLogger.log({
                agentId: agent.id,
                agentName: agent.name,
                agentEmoji: agent.emoji,
                action: result.success ? 'handle' : 'error',
                summary: result.message,
                messageId: message.id,
            });

        } catch (error: any) {
            console.log(`   ❌ Agent error: ${error.message}`);
            this.respondToAdmin(message, `Error processing command: ${error.message}`);
        }
    }

    /** Find the best agent to handle a command based on keywords and description */
    private findBestAgent(content: string): AgentDefinition | null {
        const lowerContent = content.toLowerCase();
        let bestAgent: AgentDefinition | null = null;
        let bestScore = 0;

        for (const agent of this.agents.values()) {
            if (!agent.running) continue;

            let score = 0;

            // Check keywords
            for (const keyword of agent.keywords) {
                if (lowerContent.includes(keyword.toLowerCase())) {
                    score += 10;
                }
            }

            // Check capabilities
            for (const capability of agent.capabilities) {
                if (lowerContent.includes(capability.toLowerCase())) {
                    score += 5;
                }
            }

            // Check description words
            const descWords = agent.description.toLowerCase().split(/\s+/);
            for (const word of descWords) {
                if (word.length > 3 && lowerContent.includes(word)) {
                    score += 1;
                }
            }

            if (score > bestScore) {
                bestScore = score;
                bestAgent = agent;
            }
        }

        // Require minimum score to match
        return bestScore >= 5 ? bestAgent : null;
    }

    /** Send a response back to admin */
    private respondToAdmin(originalMessage: MessageData, response: string): void {
        console.log(`   📤 Responding to admin: "${response.slice(0, 50)}..."`);
        this.responseChannel.send(
            'orchestrator',
            'Geeksy',
            originalMessage.id,
            response,
            { userId: originalMessage.userId, source: originalMessage.source }
        );
    }

    // ============================================
    // Job Processing
    // ============================================

    /** Process a regular message through job filters */
    private async processWithJobs(message: MessageData): Promise<void> {
        console.log(`📋 Checking ${this.jobs.size} jobs...`);

        for (const job of this.jobs.values()) {
            if (!job.active) continue;

            if (this.matchesFilter(message, job.filter)) {
                console.log(`   ✅ Matched job: ${job.emoji} ${job.name}`);
                await this.executeJob(job, message);
            }
        }
    }

    /** Check if a message matches a job's filter */
    private matchesFilter(message: MessageData, filter: JobFilter): boolean {
        // Match all
        if (filter.matchAll) return true;

        // From specific user
        if (filter.fromUser && message.userId !== filter.fromUser) {
            return false;
        }

        // From specific source
        if (filter.fromSource && message.source !== filter.fromSource) {
            return false;
        }

        // Contains words
        if (filter.containsWords && filter.containsWords.length > 0) {
            const lowerContent = message.content.toLowerCase();
            const hasWord = filter.containsWords.some(word =>
                lowerContent.includes(word.toLowerCase())
            );
            if (!hasWord) return false;
        }

        return true;
    }

    /** Execute a job's action */
    private async executeJob(job: PersistentJob, message: MessageData): Promise<JobExecutionResult> {
        console.log(`   ⚡ Executing job: ${job.name}`);

        // Update stats
        job.triggerCount++;
        job.lastTriggeredAt = Date.now();

        // Log activity
        this.activityLogger.log({
            agentId: job.createdByAgentId,
            agentName: job.name,
            agentEmoji: job.emoji,
            action: 'handle',
            summary: `Job triggered by: ${message.content.slice(0, 30)}...`,
            messageId: message.id,
        });

        try {
            switch (job.action.type) {
                case 'respond':
                    if (job.action.responseContent) {
                        this.responseChannel.send(
                            job.createdByAgentId,
                            job.name,
                            message.id,
                            job.action.responseContent,
                            { userId: message.userId, source: message.source }
                        );
                        return { success: true, message: 'Response sent', responseSent: job.action.responseContent };
                    }
                    break;

                case 'execute':
                    // Execute custom code (sandboxed)
                    if (job.action.executeCode) {
                        // TODO: Implement sandboxed code execution
                        console.log(`   💻 Would execute: ${job.action.executeCode.slice(0, 50)}...`);
                    }
                    break;

                case 'forward':
                    // Forward to another user/channel
                    if (job.action.targetUser || job.action.targetChannel) {
                        // TODO: Implement forwarding
                        console.log(`   📨 Would forward to: ${job.action.targetUser || job.action.targetChannel}`);
                    }
                    break;

                case 'spawn-agent':
                    // Spawn another agent to handle this
                    if (job.action.spawnAgentId) {
                        const agent = this.agents.get(job.action.spawnAgentId);
                        const handler = this.agentHandlers.get(job.action.spawnAgentId);
                        if (agent && handler) {
                            await handler(message, job.action.spawnAgentArgs || {});
                        }
                    }
                    break;
            }

            return { success: true, message: 'Job executed successfully' };
        } catch (error: any) {
            console.log(`   ❌ Job execution error: ${error.message}`);
            return { success: false, message: error.message };
        }
    }

    // ============================================
    // Job Management
    // ============================================

    /** Get all registered jobs */
    getJobs(): PersistentJob[] {
        return Array.from(this.jobs.values());
    }

    /** Get all registered agents */
    getAgents(): AgentDefinition[] {
        return Array.from(this.agents.values());
    }

    /** Deactivate a job */
    deactivateJob(jobId: string): boolean {
        const job = this.jobs.get(jobId);
        if (job) {
            job.active = false;
            return true;
        }
        return false;
    }

    /** Activate a job */
    activateJob(jobId: string): boolean {
        const job = this.jobs.get(jobId);
        if (job) {
            job.active = true;
            return true;
        }
        return false;
    }

    /** Delete a job */
    deleteJob(jobId: string): boolean {
        return this.jobs.delete(jobId);
    }
}

// ============================================
// Helper Functions
// ============================================

/** Generate a unique ID */
export function generateJobId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/** Create a simple response job */
export function createResponseJob(
    name: string,
    emoji: string,
    filter: JobFilter,
    responseContent: string,
    createdByAgentId: string
): PersistentJob {
    return {
        id: generateJobId(),
        name,
        emoji,
        description: `Responds with: ${responseContent.slice(0, 30)}...`,
        createdByAgentId,
        filter,
        action: {
            type: 'respond',
            responseContent,
        },
        active: true,
        triggerCount: 0,
        createdAt: Date.now(),
    };
}
