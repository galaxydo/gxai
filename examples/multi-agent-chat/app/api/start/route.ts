import { startAgent } from '../../../orchestrator';

// POST /api/start - Start an agent process
export async function POST(req: Request) {
    const { name } = await req.json() as { name: string };

    if (!name) {
        return Response.json({ error: 'Agent name is required' }, { status: 400 });
    }

    const result = await startAgent(name);
    return Response.json(result, { status: result.success ? 200 : 500 });
}
