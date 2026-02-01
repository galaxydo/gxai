/**
 * Process Message API - Trigger job execution for a contact message
 * 
 * This is the main entry point for processing incoming messages:
 * 1. Records the incoming message
 * 2. Finds agents bound to the contact
 * 3. Executes each agent's code
 * 4. Returns the results
 */

import { getContactManager } from '../../../../../core/contact-manager';
import { getJobExecutor } from '../../../../../core/job-executor';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { contactId, content, telegramData } = body;

        if (!content) {
            return Response.json(
                { error: 'content is required' },
                { status: 400 }
            );
        }

        const contactManager = getContactManager();
        const jobExecutor = getJobExecutor();

        // Get or create contact
        let contact;
        if (contactId) {
            contact = contactManager.getContact(contactId);
        } else if (telegramData) {
            contact = contactManager.upsertFromTelegram(telegramData);
        }

        if (!contact) {
            return Response.json(
                { error: 'Contact not found and no telegramData provided' },
                { status: 400 }
            );
        }

        // Record incoming message
        const message = contactManager.recordIncoming(contact.contactId, content, telegramData);

        // Execute agents
        const results = await jobExecutor.executeForMessage(
            contact.contactId,
            message.messageId,
            content
        );

        return Response.json({
            messageId: message.messageId,
            contact: {
                id: contact.contactId,
                name: contact.displayName,
            },
            results,
        });
    } catch (error: any) {
        console.error('Process message error:', error);
        return Response.json(
            { error: error.message },
            { status: 500 }
        );
    }
}
