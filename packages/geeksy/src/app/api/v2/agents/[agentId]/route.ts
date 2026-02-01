/**
 * Single Agent API - Get, update, delete agent
 */

import { getAgentManager } from '../../../../../core/agent-manager';

export function GET(
    request: Request,
    { params }: { params: { agentId: string } }
) {
    const agentManager = getAgentManager();
    const agent = agentManager.getAgentWithStats(params.agentId);

    if (!agent) {
        return Response.json(
            { error: 'Agent not found' },
            { status: 404 }
        );
    }

    return Response.json(agent);
}

export async function PATCH(
    request: Request,
    { params }: { params: { agentId: string } }
) {
    try {
        const body = await request.json();
        const agentManager = getAgentManager();
        const agent = agentManager.updateAgent(params.agentId, body);

        if (!agent) {
            return Response.json(
                { error: 'Agent not found' },
                { status: 404 }
            );
        }

        return Response.json(agent);
    } catch (error: any) {
        return Response.json(
            { error: error.message },
            { status: 500 }
        );
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: { agentId: string } }
) {
    try {
        const agentManager = getAgentManager();
        const success = agentManager.deleteAgent(params.agentId);

        if (!success) {
            return Response.json(
                { error: 'Agent not found' },
                { status: 404 }
            );
        }

        return Response.json({ success: true });
    } catch (error: any) {
        return Response.json(
            { error: error.message },
            { status: 500 }
        );
    }
}
