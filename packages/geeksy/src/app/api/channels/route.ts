/**
 * Channels API - Manage incoming message channels
 */
import { getChannelManager } from '../../../server';

export async function GET() {
    const channels = getChannelManager();
    return Response.json(await channels.getAll());
}

export async function POST(req: Request) {
    const channels = getChannelManager();
    const body = await req.json();
    const { action, ...data } = body;

    if (action === 'create') {
        const { name, type, emoji, config } = data;

        if (!name || !type) {
            return Response.json(
                { error: 'name and type are required' },
                { status: 400 }
            );
        }

        const channel = await channels.create(name, type, emoji || '📨', config || {});
        return Response.json(channel);
    }

    if (action === 'toggle') {
        const { channelId } = data;
        const enabled = await channels.toggle(channelId);
        return Response.json({ channelId, enabled });
    }

    if (action === 'update') {
        const { channelId, ...updates } = data;
        await channels.update(channelId, updates);
        return Response.json({ success: true });
    }

    if (action === 'delete') {
        const { channelId } = data;
        await channels.delete(channelId);
        return Response.json({ success: true });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
}
