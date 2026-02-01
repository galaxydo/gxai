/**
 * Agent Manager - Manages agent code templates
 * 
 * Agents are code templates that:
 * - Can be published with custom code
 * - Have access to conversation history
 * - Can invoke gxai inference steps
 * - Meta-agents can create other agents
 */

import { getNewDatabase, generateId, type AgentCode } from './schemas';

export interface AgentWithStats extends AgentCode {
    contacts?: Array<{ contactId: string; displayName: string }>;
}

export class AgentManager {
    private db = getNewDatabase();

    // ============================================
    // Agent CRUD
    // ============================================

    /** Get all agents */
    getAllAgents(): AgentCode[] {
        const all = this.db.agents.findMany({});
        return all.sort((a, b) => b.createdAt - a.createdAt);
    }

    /** Get enabled agents */
    getEnabledAgents(): AgentCode[] {
        const all = this.db.agents.findMany({ enabled: true });
        return all.sort((a, b) => (b.jobCount || 0) - (a.jobCount || 0));
    }

    /** Get agent by ID */
    getAgent(agentId: string): AgentCode | null {
        return this.db.agents.findOne({ agentId }) || null;
    }

    /** Get agent with contact information */
    getAgentWithStats(agentId: string): AgentWithStats | null {
        const agent = this.getAgent(agentId);
        if (!agent) return null;

        const bindings = this.db.contactAgents.findMany({ agentId });
        const enabledBindings = bindings.filter(b => b.enabled);

        const contacts: AgentWithStats['contacts'] = [];
        for (const binding of enabledBindings) {
            const contact = this.db.contacts.findOne({ contactId: binding.contactId });
            if (contact) {
                contacts.push({ contactId: contact.contactId, displayName: contact.displayName });
            }
        }

        return { ...agent, contacts };
    }

    /** Create a new agent */
    createAgent(data: {
        name: string;
        emoji: string;
        description: string;
        code: string;
        systemPrompt?: string;
        canCreateAgents?: boolean;
        canAttachContacts?: boolean;
        canSendMessages?: boolean;
        createdByAgentId?: string;
    }): AgentCode {
        const now = Date.now();
        const agentId = generateId('agent');

        const id = this.db.agents.insert({
            agentId,
            name: data.name,
            emoji: data.emoji,
            description: data.description,
            code: data.code,
            systemPrompt: data.systemPrompt,
            version: 1,
            enabled: true,
            canCreateAgents: data.canCreateAgents || false,
            canAttachContacts: data.canAttachContacts || false,
            canSendMessages: data.canSendMessages || false,
            contactCount: 0,
            jobCount: 0,
            successCount: 0,
            failureCount: 0,
            createdByAgentId: data.createdByAgentId,
            createdAt: now,
            updatedAt: now,
        });

        console.log(`🤖 Created agent: ${data.emoji} ${data.name}`);
        return this.db.agents.findOne({ id })!;
    }

    /** Update agent code */
    updateAgent(agentId: string, data: Partial<{
        name: string;
        emoji: string;
        description: string;
        code: string;
        systemPrompt: string;
        enabled: boolean;
        canCreateAgents: boolean;
        canAttachContacts: boolean;
        canSendMessages: boolean;
    }>): AgentCode | null {
        const agent = this.db.agents.findOne({ agentId });
        if (!agent) return null;

        this.db.agents.update({ agentId }, {
            ...data,
            version: agent.version + 1,
            updatedAt: Date.now(),
        });

        return this.db.agents.findOne({ agentId })!;
    }

    /** Delete an agent */
    deleteAgent(agentId: string): boolean {
        const agent = this.db.agents.findOne({ agentId });
        if (!agent) return false;

        // Remove all bindings
        const bindings = this.db.contactAgents.findMany({ agentId });
        for (const binding of bindings) {
            this.db.contactAgents.delete({ bindingId: binding.bindingId });
        }

        this.db.agents.delete({ agentId });
        console.log(`🗑️ Deleted agent: ${agent.emoji} ${agent.name}`);
        return true;
    }

    /** Record job completion */
    recordJobResult(agentId: string, success: boolean): void {
        const agent = this.db.agents.findOne({ agentId });
        if (!agent) return;

        this.db.agents.update({ agentId }, {
            jobCount: Number(agent.jobCount || 0) + 1,
            successCount: success ? Number(agent.successCount || 0) + 1 : Number(agent.successCount || 0),
            failureCount: !success ? Number(agent.failureCount || 0) + 1 : Number(agent.failureCount || 0),
            updatedAt: Date.now(),
        });
    }

    // ============================================
    // Built-in Agents
    // ============================================

    /** Initialize built-in agents if they don't exist */
    initBuiltInAgents(): void {
        // Admin Agent - The powerful meta-agent
        if (!this.getAgent('admin-agent')) {
            this.db.agents.insert({
                agentId: 'admin-agent',
                name: 'Admin Agent',
                emoji: '👑',
                description: 'Powerful meta-agent that can create other agents, attach them to contacts, and manage the system.',
                code: ADMIN_AGENT_CODE,
                systemPrompt: ADMIN_AGENT_PROMPT,
                version: 1,
                enabled: true,
                canCreateAgents: true,
                canAttachContacts: true,
                canSendMessages: true,
                contactCount: 0,
                jobCount: 0,
                successCount: 0,
                failureCount: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
            console.log(`🤖 Created built-in: 👑 Admin Agent`);
        }

        // Simple Responder - Basic message handler
        if (!this.getAgent('simple-responder')) {
            this.db.agents.insert({
                agentId: 'simple-responder',
                name: 'Simple Responder',
                emoji: '💬',
                description: 'A simple agent that uses LLM to generate contextual responses based on conversation history.',
                code: SIMPLE_RESPONDER_CODE,
                systemPrompt: 'You are a helpful assistant. Respond naturally and helpfully to messages.',
                version: 1,
                enabled: true,
                canCreateAgents: false,
                canAttachContacts: false,
                canSendMessages: true,
                contactCount: 0,
                jobCount: 0,
                successCount: 0,
                failureCount: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
            console.log(`🤖 Created built-in: 💬 Simple Responder`);
        }
    }
}

// ============================================
// Built-in Agent Code Templates
// ============================================

const ADMIN_AGENT_PROMPT = `You are the Admin Agent, a powerful meta-agent for the Geeksy system.
You can:
1. Create new agents with custom code
2. Attach agents to contacts
3. Send messages on behalf of the assistant
4. Analyze what agents exist and their capabilities

When the admin asks you to do something like "schedule a meeting with Alex", you should:
1. Check if an appropriate agent exists for this task
2. If not, create a new agent with code to handle it
3. Attach the agent to the relevant contact
4. Optionally send an initial message

Always think step by step about what agents and capabilities are needed.`;

const ADMIN_AGENT_CODE = `
// Admin Agent - Meta-agent with full system access
async function run(ctx) {
    const { message, conversation, api } = ctx;
    
    // First, understand what the admin wants
    const analysis = await api.infer({
        systemPrompt: \`Analyze this admin request and determine what action to take.
        Available actions: create_agent, attach_agent, send_message, list_agents, help\`,
        prompt: message.content,
        outputFormat: { action: 'string', details: 'object' }
    });
    
    switch (analysis.action) {
        case 'create_agent':
            // Generate code for the new agent
            const newAgentCode = await api.infer({
                systemPrompt: 'Generate TypeScript code for a Geeksy agent that handles the described task.',
                prompt: JSON.stringify(analysis.details),
                outputFormat: { name: 'string', emoji: 'string', description: 'string', code: 'string' }
            });
            
            const agent = await api.createAgent(newAgentCode);
            return { response: \`Created agent: \${agent.emoji} \${agent.name}\` };
            
        case 'attach_agent':
            await api.attachAgent(analysis.details.contactId, analysis.details.agentId);
            return { response: 'Agent attached to contact.' };
            
        case 'send_message':
            await api.sendMessage(analysis.details.contactId, analysis.details.content);
            return { response: 'Message sent.' };
            
        case 'list_agents':
            const agents = await api.listAgents();
            return { response: 'Available agents: ' + agents.map(a => a.emoji + ' ' + a.name).join(', ') };
            
        default:
            return { response: 'How can I help you manage your agents?' };
    }
}
`;

const SIMPLE_RESPONDER_CODE = `
// Simple Responder - Uses LLM to generate contextual responses
async function run(ctx) {
    const { message, conversation, api } = ctx;
    
    // Build conversation context
    const messages = conversation.map(m => ({
        role: m.role,
        content: m.content
    }));
    
    // Generate response using gxai inference
    const response = await api.infer({
        systemPrompt: ctx.agent.systemPrompt || 'You are a helpful assistant.',
        messages: messages,
        prompt: message.content,
        outputFormat: { response: 'string' }
    });
    
    return { response: response.response };
}
`;

let agentManager: AgentManager | null = null;

export function getAgentManager(): AgentManager {
    if (!agentManager) {
        agentManager = new AgentManager();
        agentManager.initBuiltInAgents();
    }
    return agentManager;
}
