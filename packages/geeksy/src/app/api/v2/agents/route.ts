/**
 * Agents API - Get all agents
 */

import { getAgentManager } from '../../../../core/agent-manager';

export function GET() {
    const agentManager = getAgentManager();
    const agents = agentManager.getAllAgents();

    return Response.json(agents);
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { name, emoji, description, code, systemPrompt, canCreateAgents, canAttachContacts, canSendMessages } = body;

        if (!name || !emoji || !description || !code) {
            return Response.json(
                { error: 'name, emoji, description, and code are required' },
                { status: 400 }
            );
        }

        const agentManager = getAgentManager();
        const agent = agentManager.createAgent({
            name,
            emoji,
            description,
            code,
            systemPrompt,
            canCreateAgents,
            canAttachContacts,
            canSendMessages,
        });

        return Response.json(agent);
    } catch (error: any) {
        return Response.json(
            { error: error.message },
            { status: 500 }
        );
    }
}
