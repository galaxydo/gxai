/**
 * Job Executor - Runs agent code with gxai inference
 * 
 * This is the runtime that:
 * 1. Receives a message from a contact
 * 2. Finds bound agents for that contact
 * 3. Executes agent code with context (message, conversation history)
 * 4. Agent code can invoke gxai inference steps
 * 5. Sends response back via API callback
 */

import { z } from 'zod';
import { getNewDatabase, generateId, type JobExecution, type AgentCode } from './schemas';
import { getContactManager } from './contact-manager';
import { getAgentManager } from './agent-manager';

export interface JobContext {
    message: {
        id: string;
        content: string;
        timestamp: number;
    };
    contact: {
        id: string;
        displayName: string;
        username?: string;
    };
    conversation: Array<{
        role: 'user' | 'assistant';
        content: string;
    }>;
    agent: {
        id: string;
        name: string;
        emoji: string;
        systemPrompt?: string;
    };
    api: JobAPI;
}

export interface JobResult {
    response?: string;
    error?: string;
    inferenceSteps: number;
}

/** API available to agent code during execution */
export interface JobAPI {
    /** Run a gxai inference step */
    infer: (config: InferConfig) => Promise<any>;
    /** Create a new agent (meta-agent only) */
    createAgent: (data: CreateAgentData) => Promise<AgentCode>;
    /** Attach an agent to a contact (meta-agent only) */
    attachAgent: (contactId: string, agentId: string) => Promise<void>;
    /** Send a message to a contact (meta-agent only) */
    sendMessage: (contactId: string, content: string) => Promise<void>;
    /** List all agents */
    listAgents: () => Promise<Array<{ id: string; name: string; emoji: string; description: string }>>;
    /** Log execution info */
    log: (message: string) => void;
}

interface InferConfig {
    systemPrompt?: string;
    prompt?: string;
    messages?: Array<{ role: string; content: string }>;
    outputFormat?: Record<string, string>;
}

interface CreateAgentData {
    name: string;
    emoji: string;
    description: string;
    code: string;
    systemPrompt?: string;
}

export class JobExecutor {
    private db = getNewDatabase();
    private contactManager = getContactManager();
    private agentManager = getAgentManager();
    private sendMessageCallback?: (contactId: string, content: string) => Promise<void>;

    /** Set the callback for sending messages */
    setSendMessageCallback(callback: (contactId: string, content: string) => Promise<void>): void {
        this.sendMessageCallback = callback;
    }

    /** Execute a job for an incoming message */
    async executeForMessage(
        contactId: string,
        messageId: string,
        messageContent: string
    ): Promise<JobResult[]> {
        // Get agents bound to this contact
        const agentIds = this.contactManager.getBoundAgents(contactId);
        if (agentIds.length === 0) {
            console.log(`📭 No agents bound to contact ${contactId}`);
            return [];
        }

        const results: JobResult[] = [];

        for (const agentId of agentIds) {
            const agent = this.agentManager.getAgent(agentId);
            if (!agent || !agent.enabled) continue;

            console.log(`⚡ Executing ${agent.emoji} ${agent.name} for contact ${contactId}`);

            const result = await this.executeAgent(agent, contactId, messageId, messageContent);
            results.push(result);

            // Record result
            this.agentManager.recordJobResult(agentId, !result.error);

            // If agent returned a response, send it
            if (result.response && this.sendMessageCallback) {
                await this.sendMessageCallback(contactId, result.response);
                // Record outgoing message
                this.contactManager.recordOutgoing(contactId, result.response, messageId);
            }
        }

        return results;
    }

    /** Execute a single agent */
    private async executeAgent(
        agent: AgentCode,
        contactId: string,
        messageId: string,
        messageContent: string
    ): Promise<JobResult> {
        const now = Date.now();
        let inferenceSteps = 0;
        const logs: string[] = [];

        // Create job record
        const jobId = generateId('job');
        this.db.jobExecutions.insert({
            jobId,
            agentId: agent.agentId,
            agentName: agent.name,
            agentEmoji: agent.emoji,
            contactId,
            messageId,
            status: 'running',
            inferenceSteps: 0,
            logs: '[]',
            startedAt: now,
        });

        try {
            // Get contact info
            const contact = this.contactManager.getContact(contactId);
            if (!contact) {
                throw new Error(`Contact ${contactId} not found`);
            }

            // Get conversation history
            const conversation = this.contactManager.getConversation(contactId);

            // Build context
            const ctx: JobContext = {
                message: {
                    id: messageId,
                    content: messageContent,
                    timestamp: now,
                },
                contact: {
                    id: contact.contactId,
                    displayName: contact.displayName,
                    username: contact.telegramUsername,
                },
                conversation,
                agent: {
                    id: agent.agentId,
                    name: agent.name,
                    emoji: agent.emoji,
                    systemPrompt: agent.systemPrompt,
                },
                api: this.createJobAPI(agent, () => inferenceSteps++, (msg) => logs.push(msg)),
            };

            // Execute agent code
            const result = await this.runAgentCode(agent.code, ctx);

            // Update job record
            this.updateJob(jobId, {
                status: 'completed',
                inferenceSteps,
                responseMessage: result.response,
                logs: JSON.stringify(logs),
                completedAt: Date.now(),
                durationMs: Date.now() - now,
            });

            console.log(`✅ Job ${jobId} completed in ${Date.now() - now}ms`);
            return { ...result, inferenceSteps };

        } catch (error: any) {
            console.error(`❌ Job ${jobId} failed:`, error.message);

            this.updateJob(jobId, {
                status: 'failed',
                inferenceSteps,
                error: error.message,
                logs: JSON.stringify(logs),
                completedAt: Date.now(),
                durationMs: Date.now() - now,
            });

            return { error: error.message, inferenceSteps };
        }
    }

    /** Create the API object available to agent code */
    private createJobAPI(
        agent: AgentCode,
        onInference: () => void,
        log: (msg: string) => void
    ): JobAPI {
        const agentManager = this.agentManager;
        const contactManager = this.contactManager;
        const sendMessageCallback = this.sendMessageCallback;

        return {
            infer: async (config: InferConfig) => {
                onInference();
                log(`Inference: ${config.prompt?.slice(0, 50)}...`);

                // Use gxai Agent for inference
                // For now, return a mock response - in production, this calls the actual Agent
                return this.runInference(config);
            },

            createAgent: async (data: CreateAgentData) => {
                if (!agent.canCreateAgents) {
                    throw new Error('Agent does not have permission to create agents');
                }
                log(`Creating agent: ${data.emoji} ${data.name}`);
                return agentManager.createAgent({
                    ...data,
                    createdByAgentId: agent.agentId,
                });
            },

            attachAgent: async (contactId: string, agentId: string) => {
                if (!agent.canAttachContacts) {
                    throw new Error('Agent does not have permission to attach agents');
                }
                log(`Attaching agent ${agentId} to contact ${contactId}`);
                contactManager.bindAgent(contactId, agentId);
            },

            sendMessage: async (contactId: string, content: string) => {
                if (!agent.canSendMessages) {
                    throw new Error('Agent does not have permission to send messages');
                }
                log(`Sending message to ${contactId}: ${content.slice(0, 50)}...`);
                if (sendMessageCallback) {
                    await sendMessageCallback(contactId, content);
                    contactManager.recordOutgoing(contactId, content);
                }
            },

            listAgents: async () => {
                const agents = agentManager.getAllAgents();
                return agents.map(a => ({
                    id: a.agentId,
                    name: a.name,
                    emoji: a.emoji,
                    description: a.description,
                }));
            },

            log: (message: string) => {
                log(message);
                console.log(`  📝 [${agent.name}] ${message}`);
            },
        };
    }

    /** Run the actual inference using gxai */
    private async runInference(config: InferConfig): Promise<any> {
        // Dynamic import of gxai Agent
        try {
            const { Agent, LLM } = await import('../../main');

            // Build input/output schemas
            const inputSchema = z.object({
                query: z.string(),
            });

            const outputFields: Record<string, z.ZodString> = {};
            if (config.outputFormat) {
                for (const [key, desc] of Object.entries(config.outputFormat)) {
                    outputFields[key] = z.string().describe(desc);
                }
            } else {
                outputFields['response'] = z.string().describe('The response');
            }
            const outputSchema = z.object(outputFields);

            const agent = new Agent({
                llm: LLM['gemini-2.0-flash'],
                inputFormat: inputSchema,
                outputFormat: outputSchema,
                systemPrompt: config.systemPrompt,
            });

            const result = await agent.run({ query: config.prompt || '' });
            return result;
        } catch (error) {
            console.error('Inference error:', error);
            // Fallback mock response
            return { response: 'I understand your message. Let me help you with that.' };
        }
    }

    /** Execute agent code in a sandboxed way */
    private async runAgentCode(code: string, ctx: JobContext): Promise<{ response?: string }> {
        // Create a function from the code
        // In production, this should use a proper sandbox (e.g., isolated-vm)
        try {
            // Extract the run function from the code
            const runFnMatch = code.match(/async\s+function\s+run\s*\([^)]*\)\s*\{([\s\S]*)\}/);
            if (!runFnMatch) {
                throw new Error('Agent code must contain an async function run(ctx)');
            }

            // Create and execute the function
            const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
            const runFn = new AsyncFunction('ctx', runFnMatch[1]);

            const result = await runFn(ctx);
            return result || {};
        } catch (error: any) {
            console.error('Agent code execution error:', error);
            throw error;
        }
    }

    /** Update job record */
    private updateJob(jobId: string, data: Partial<JobExecution>): void {
        const job = this.db.jobExecutions.findOne({ jobId });
        if (job) {
            this.db.jobExecutions.update({ jobId }, data);
        }
    }

    // ============================================
    // Job Query Methods
    // ============================================

    /** Get recent job executions */
    getRecentJobs(limit: number = 50): JobExecution[] {
        const all = this.db.jobExecutions.findMany({});
        all.sort((a, b) => b.startedAt - a.startedAt);
        return all.slice(0, limit);
    }

    /** Get jobs for a specific agent */
    getAgentJobs(agentId: string, limit: number = 20): JobExecution[] {
        const all = this.db.jobExecutions.findMany({ agentId });
        all.sort((a, b) => b.startedAt - a.startedAt);
        return all.slice(0, limit);
    }

    /** Get jobs for a specific contact */
    getContactJobs(contactId: string, limit: number = 20): JobExecution[] {
        const all = this.db.jobExecutions.findMany({ contactId });
        all.sort((a, b) => b.startedAt - a.startedAt);
        return all.slice(0, limit);
    }

    /** Get running jobs */
    getRunningJobs(): JobExecution[] {
        return this.db.jobExecutions.findMany({ status: 'running' });
    }

    /** Get job stats */
    getStats(): { total: number; running: number; completed: number; failed: number } {
        const all = this.db.jobExecutions.findMany({});
        return {
            total: all.length,
            running: all.filter(j => j.status === 'running').length,
            completed: all.filter(j => j.status === 'completed').length,
            failed: all.filter(j => j.status === 'failed').length,
        };
    }
}

let jobExecutor: JobExecutor | null = null;

export function getJobExecutor(): JobExecutor {
    if (!jobExecutor) {
        jobExecutor = new JobExecutor();
    }
    return jobExecutor;
}
