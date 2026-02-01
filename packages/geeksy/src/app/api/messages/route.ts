/**
 * Messages API - Publishes and retrieves messages
 */
import { getMessageBus } from '../../../server';

export async function GET() {
    const bus = getMessageBus();
    const messages = await bus.getRecent(50);

    return Response.json(messages);
}

export async function POST(req: Request) {
    const bus = getMessageBus();
    const body = await req.json();
    const { source, content, sourceId, userId } = body;

    if (!content) {
        return Response.json({ error: 'Content is required' }, { status: 400 });
    }

    const message = await bus.publish(
        source || 'test',
        content,
        { sourceId, userId }
    );

    return Response.json(message);
}
