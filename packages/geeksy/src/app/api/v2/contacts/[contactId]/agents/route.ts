/**
 * Contact Agents API - Manage agent bindings for a contact
 */

import { getContactManager } from '../../../../../../core/contact-manager';

export function GET(
    request: Request,
    { params }: { params: { contactId: string } }
) {
    const contactManager = getContactManager();
    const agentIds = contactManager.getBoundAgents(params.contactId);

    return Response.json(agentIds);
}

export async function POST(
    request: Request,
    { params }: { params: { contactId: string } }
) {
    try {
        const body = await request.json();
        const { agentId, priority } = body;

        if (!agentId) {
            return Response.json(
                { error: 'agentId is required' },
                { status: 400 }
            );
        }

        const contactManager = getContactManager();
        const binding = contactManager.bindAgent(params.contactId, agentId, priority || 0);

        return Response.json(binding);
    } catch (error: any) {
        return Response.json(
            { error: error.message },
            { status: 500 }
        );
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: { contactId: string } }
) {
    try {
        const url = new URL(request.url);
        const agentId = url.searchParams.get('agentId');

        if (!agentId) {
            return Response.json(
                { error: 'agentId query param is required' },
                { status: 400 }
            );
        }

        const contactManager = getContactManager();
        const success = contactManager.unbindAgent(params.contactId, agentId);

        return Response.json({ success });
    } catch (error: any) {
        return Response.json(
            { error: error.message },
            { status: 500 }
        );
    }
}
