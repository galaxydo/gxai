import { getAgentStatuses } from '../../../orchestrator';

// GET /api/processes - Get status of all agent processes
export async function GET() {
    const statuses = await getAgentStatuses();
    return Response.json(statuses);
}
