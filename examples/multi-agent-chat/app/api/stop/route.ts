import { stopAgent } from '../../../orchestrator';

// POST /api/stop - Stop an agent process
export async function POST(req: Request) {
    const { name } = await req.json() as { name: string };

    if (!name) {
        return Response.json({ error: 'Agent name is required' }, { status: 400 });
    }

    const result = await stopAgent(name);
    return Response.json(result, { status: result.success ? 200 : 500 });
}
