/**
 * Contacts API - Get all contacts with agents
 */

import { getContactManager } from '../../../../core/contact-manager';

export function GET(request: Request) {
    const url = new URL(request.url);
    const includeHidden = url.searchParams.get('includeHidden') === 'true';
    const onlyWithAgents = url.searchParams.get('onlyWithAgents') === 'true';

    const contactManager = getContactManager();
    const contacts = contactManager.getContactsWithAgents({
        includeHidden,
        onlyWithAgents,
    });

    return Response.json(contacts);
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { telegramId, telegramUsername, firstName, lastName } = body;

        if (!telegramId || !firstName) {
            return Response.json(
                { error: 'telegramId and firstName are required' },
                { status: 400 }
            );
        }

        const contactManager = getContactManager();
        const contact = contactManager.upsertFromTelegram({
            telegramId,
            telegramUsername,
            firstName,
            lastName,
        });

        return Response.json(contact);
    } catch (error: any) {
        return Response.json(
            { error: error.message },
            { status: 500 }
        );
    }
}
