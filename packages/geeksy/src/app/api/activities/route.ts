/**
 * Activities API - Activity stream endpoints
 */
import { getActivityStream } from '../../../server';

export async function GET() {
    const stream = getActivityStream();
    const activities = await stream.getRecent(100);

    return Response.json(activities);
}

export async function POST(req: Request) {
    const stream = getActivityStream();
    const body = await req.json();

    const { agentId, agentName, agentEmoji, action, summary, messageId, details } = body;

    if (!agentId || !action || !summary) {
        return Response.json(
            { error: 'agentId, action, and summary are required' },
            { status: 400 }
        );
    }

    const event = await stream.record(
        agentId,
        agentName || agentId,
        agentEmoji || '🤖',
        action,
        summary,
        { messageId, details }
    );

    return Response.json(event);
}
