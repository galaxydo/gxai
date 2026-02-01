/**
 * Contact Messages API - Get message history for a contact
 */

import { getContactManager } from '../../../../../../core/contact-manager';

export function GET(
    request: Request,
    { params }: { params: { contactId: string } }
) {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '50');

    const contactManager = getContactManager();
    const messages = contactManager.getMessageHistory(params.contactId, limit);

    return Response.json(messages);
}
