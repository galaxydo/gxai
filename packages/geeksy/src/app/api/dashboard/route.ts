/**
 * Dashboard Data API - Returns all data for the dashboard in one request
 */
import { getAgentRegistry, getMessageBus, getActivityStream } from '../../../server';

export async function GET() {
    const registry = getAgentRegistry();
    const bus = getMessageBus();
    const activity = getActivityStream();

    const [agents, messages, activities] = await Promise.all([
        registry.getAll(),
        bus.getRecent(50),
        activity.getRecent(100)
    ]);

    return Response.json({ agents, messages, activities });
}
