/**
 * Responses API - Queue and retrieve agent responses
 */
import { getResponseChannel } from '../../../server';

export async function GET(req: Request) {
    const channel = getResponseChannel();
    const url = new URL(req.url);
    const source = url.searchParams.get('source');
    const pending = url.searchParams.get('pending') === 'true';

    if (pending) {
        const responses = await channel.getPending();
        return Response.json(responses);
    }

    const responses = await channel.getSent(50);
    return Response.json(responses);
}

export async function POST(req: Request) {
    const channel = getResponseChannel();
    const body = await req.json();

    const { messageId, agentId, agentName, content, targetSource, targetSourceId, targetUserId } = body;

    if (!messageId || !agentId || !content || !targetSource) {
        return Response.json(
            { error: 'messageId, agentId, content, and targetSource are required' },
            { status: 400 }
        );
    }

    const response = await channel.queue(
        messageId,
        agentId,
        agentName || agentId,
        content,
        targetSource,
        { targetSourceId, targetUserId }
    );

    return Response.json(response);
}
