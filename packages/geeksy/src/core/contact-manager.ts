/**
 * Contact Manager - Manages contacts and their agent bindings
 * 
 * Handles:
 * - Contact CRUD operations
 * - Message history per contact
 * - Agent bindings to contacts
 */

import { getNewDatabase, generateId, type Contact, type ContactAgent, type MessageHistory } from './schemas';

export interface ContactWithAgents extends Contact {
    agents: Array<{
        agentId: string;
        name: string;
        emoji: string;
        priority: number;
        enabled: boolean;
    }>;
}

export class ContactManager {
    private db = getNewDatabase();

    // ============================================
    // Contact Operations
    // ============================================

    /** Get all contacts */
    getAllContacts(options?: { includeHidden?: boolean }): Contact[] {
        const all = this.db.contacts.findMany({});
        const filtered = options?.includeHidden ? all : all.filter(c => !c.hidden);
        return filtered.sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
    }

    /** Get contacts with their associated agents */
    getContactsWithAgents(options?: { includeHidden?: boolean; onlyWithAgents?: boolean }): ContactWithAgents[] {
        const contacts = this.getAllContacts(options);
        const result: ContactWithAgents[] = [];

        for (const contact of contacts) {
            const bindings = this.db.contactAgents.findMany({ contactId: contact.contactId });
            bindings.sort((a, b) => (b.priority || 0) - (a.priority || 0));

            const agents: ContactWithAgents['agents'] = [];
            for (const binding of bindings) {
                const agent = this.db.agents.findOne({ agentId: binding.agentId });
                if (agent) {
                    agents.push({
                        agentId: agent.agentId,
                        name: agent.name,
                        emoji: agent.emoji,
                        priority: binding.priority,
                        enabled: binding.enabled,
                    });
                }
            }

            if (options?.onlyWithAgents && agents.length === 0) {
                continue;
            }

            result.push({ ...contact, agents });
        }

        return result;
    }

    /** Get contact by ID */
    getContact(contactId: string): Contact | null {
        return this.db.contacts.findOne({ contactId }) || null;
    }

    /** Create or update contact from Telegram data */
    upsertFromTelegram(data: {
        telegramId: string;
        telegramUsername?: string;
        firstName: string;
        lastName?: string;
    }): Contact {
        const existing = this.db.contacts.findOne({ telegramId: data.telegramId });
        const now = Date.now();
        const displayName = data.lastName
            ? `${data.firstName} ${data.lastName}`
            : data.firstName;

        if (existing) {
            this.db.contacts.update({ telegramId: data.telegramId }, {
                telegramUsername: data.telegramUsername,
                firstName: data.firstName,
                lastName: data.lastName,
                displayName,
                updatedAt: now,
            });
            return this.db.contacts.findOne({ telegramId: data.telegramId })!;
        }

        const contactId = generateId('contact');
        this.db.contacts.insert({
            contactId,
            telegramId: data.telegramId,
            telegramUsername: data.telegramUsername,
            firstName: data.firstName,
            lastName: data.lastName,
            displayName,
            hidden: false,
            messageCount: 0,
            createdAt: now,
            updatedAt: now,
        });

        console.log(`👤 New contact: ${displayName}`);
        return this.db.contacts.findOne({ contactId })!;
    }

    /** Toggle contact visibility */
    toggleHidden(contactId: string): Contact | null {
        const contact = this.db.contacts.findOne({ contactId });
        if (!contact) return null;

        this.db.contacts.update({ contactId }, {
            hidden: !contact.hidden,
            updatedAt: Date.now(),
        });

        return this.db.contacts.findOne({ contactId })!;
    }

    // ============================================
    // Message History
    // ============================================

    /** Get message history for a contact */
    getMessageHistory(contactId: string, limit: number = 50): MessageHistory[] {
        const all = this.db.messageHistory.findMany({ contactId });
        all.sort((a, b) => a.timestamp - b.timestamp);
        return all.slice(-limit);
    }

    /** Get full conversation for agent context */
    getConversation(contactId: string): Array<{ role: 'user' | 'assistant'; content: string }> {
        const messages = this.getMessageHistory(contactId, 100);
        return messages.map(m => ({
            role: m.direction === 'incoming' ? 'user' : 'assistant',
            content: m.content,
        }));
    }

    /** Record incoming message */
    recordIncoming(contactId: string, content: string, metadata?: Record<string, any>): MessageHistory {
        const now = Date.now();
        const contact = this.db.contacts.findOne({ contactId });

        if (contact) {
            this.db.contacts.update({ contactId }, {
                messageCount: Number(contact.messageCount || 0) + 1,
                lastMessageAt: now,
                updatedAt: now,
            });
        }

        const messageId = generateId('msg');
        this.db.messageHistory.insert({
            messageId,
            contactId,
            direction: 'incoming',
            content,
            metadata: metadata ? JSON.stringify(metadata) : undefined,
            timestamp: now,
        });

        return this.db.messageHistory.findOne({ messageId })!;
    }

    /** Record outgoing message */
    recordOutgoing(contactId: string, content: string, jobId?: string): MessageHistory {
        const messageId = generateId('msg');
        this.db.messageHistory.insert({
            messageId,
            contactId,
            direction: 'outgoing',
            content,
            jobId,
            timestamp: Date.now(),
        });

        return this.db.messageHistory.findOne({ messageId })!;
    }

    // ============================================
    // Agent Bindings
    // ============================================

    /** Bind an agent to a contact */
    bindAgent(contactId: string, agentId: string, priority: number = 0): ContactAgent {
        const existing = this.db.contactAgents.findOne({ contactId, agentId });

        if (existing) {
            this.db.contactAgents.update({ contactId, agentId }, { priority, enabled: true });
            return this.db.contactAgents.findOne({ contactId, agentId })!;
        }

        const bindingId = generateId('bind');
        this.db.contactAgents.insert({
            bindingId,
            contactId,
            agentId,
            priority,
            enabled: true,
            createdAt: Date.now(),
        });

        // Update agent contact count
        const agent = this.db.agents.findOne({ agentId });
        if (agent) {
            this.db.agents.update({ agentId }, {
                contactCount: Number(agent.contactCount || 0) + 1,
                updatedAt: Date.now(),
            });
        }

        console.log(`🔗 Bound agent ${agentId} to contact ${contactId}`);
        return this.db.contactAgents.findOne({ bindingId })!;
    }

    /** Unbind an agent from a contact */
    unbindAgent(contactId: string, agentId: string): boolean {
        const binding = this.db.contactAgents.findOne({ contactId, agentId });

        if (!binding) return false;

        this.db.contactAgents.delete({ bindingId: binding.bindingId });

        // Update agent contact count
        const agent = this.db.agents.findOne({ agentId });
        if (agent && Number(agent.contactCount) > 0) {
            this.db.agents.update({ agentId }, {
                contactCount: Number(agent.contactCount) - 1,
                updatedAt: Date.now(),
            });
        }

        return true;
    }

    /** Get agents bound to a contact */
    getBoundAgents(contactId: string): string[] {
        const bindings = this.db.contactAgents.findMany({ contactId });
        const enabled = bindings.filter(b => b.enabled);
        enabled.sort((a, b) => (b.priority || 0) - (a.priority || 0));
        return enabled.map(b => b.agentId);
    }

    /** Get contacts bound to an agent */
    getAgentContacts(agentId: string): Contact[] {
        const bindings = this.db.contactAgents.findMany({ agentId });
        const enabled = bindings.filter(b => b.enabled);

        const contacts: Contact[] = [];
        for (const binding of enabled) {
            const contact = this.db.contacts.findOne({ contactId: binding.contactId });
            if (contact) contacts.push(contact);
        }
        return contacts;
    }
}

let contactManager: ContactManager | null = null;

export function getContactManager(): ContactManager {
    if (!contactManager) {
        contactManager = new ContactManager();
    }
    return contactManager;
}
