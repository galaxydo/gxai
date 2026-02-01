/**
 * Agents API - Manage agent registration and lifecycle
 */
import { getAgentRegistry } from '../../../server';

export async function GET() {
    const registry = getAgentRegistry();
    const agents = await registry.getAll();

    return Response.json(agents);
}

export async function POST(req: Request) {
    const registry = getAgentRegistry();
    const body = await req.json();
    const { action, agentId, ...agentData } = body;

    // Register a new agent
    if (action === 'register') {
        const { name, description, emoji, port, scriptPath, capabilities } = agentData;

        if (!agentId || !name || !port || !scriptPath) {
            return Response.json(
                { error: 'agentId, name, port, and scriptPath are required for registration' },
                { status: 400 }
            );
        }

        const agent = await registry.register({
            id: agentId,
            name,
            description: description || `Agent: ${name}`,
            emoji: emoji || '🤖',
            port,
            scriptPath,
            capabilities: capabilities || ['handle', 'respond']
        });

        return Response.json({ success: true, agent });
    }

    // Start an existing agent
    if (action === 'start') {
        if (!agentId) {
            return Response.json({ error: 'agentId is required' }, { status: 400 });
        }
        const result = await registry.start(agentId);
        return Response.json(result, { status: result.success ? 200 : 400 });
    }

    // Stop an agent
    if (action === 'stop') {
        if (!agentId) {
            return Response.json({ error: 'agentId is required' }, { status: 400 });
        }
        const result = await registry.stop(agentId);
        return Response.json(result, { status: result.success ? 200 : 400 });
    }

    return Response.json({ error: 'Invalid action. Use: register, start, or stop' }, { status: 400 });
}
