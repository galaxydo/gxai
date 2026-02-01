/**
 * Contact Toggle Hidden API
 */

import { getContactManager } from '../../../../../../core/contact-manager';

export async function POST(
    request: Request,
    { params }: { params: { contactId: string } }
) {
    try {
        const contactManager = getContactManager();
        const contact = contactManager.toggleHidden(params.contactId);

        if (!contact) {
            return Response.json(
                { error: 'Contact not found' },
                { status: 404 }
            );
        }

        return Response.json(contact);
    } catch (error: any) {
        return Response.json(
            { error: error.message },
            { status: 500 }
        );
    }
}
