/**
 * Message Bus - Central event stream for all incoming messages
 * 
 * Messages arrive from various sources (Telegram, Discord, test UI)
 * and are broadcasted to all registered agents
 */

import { getDatabase, generateId, type Message } from './database';

export type MessageSource = 'telegram' | 'discord' | 'test' | 'api' | 'webhook';

export interface MessageData {
    id: string;
    source: MessageSource;
    sourceId?: string;        // e.g., Telegram chat ID, Discord channel ID
    userId?: string;          // User who sent the message
    content: string;
    metadata?: Record<string, any>;
    timestamp: number;
}

type MessageHandler = (message: MessageData) => Promise<void> | void;

export class MessageBus {
    private handlers: Map<string, MessageHandler> = new Map();
    private broadcastChannel = new BroadcastChannel('geeksy-messages');

    constructor() {
        // Listen for messages from other processes
        this.broadcastChannel.onmessage = (event) => {
            const message = event.data as MessageData;
            this.notifyHandlers(message);
        };
    }

    /** Publish a new message to the bus */
    async publish(source: MessageSource, content: string, options?: Partial<Omit<MessageData, 'id' | 'source' | 'content' | 'timestamp'>>): Promise<MessageData> {
        const db = getDatabase();
        const messageId = generateId('msg');

        const message: MessageData = {
            id: messageId,
            source,
            content,
            timestamp: Date.now(),
            ...options
        };

        // Store in database
        db.messages.insert({
            messageId: message.id,
            source: message.source,
            sourceId: message.sourceId,
            userId: message.userId,
            content: message.content,
            metadata: message.metadata ? JSON.stringify(message.metadata) : undefined,
            timestamp: message.timestamp,
        });

        console.log(`📤 [MessageBus] Published message: ${message.id}`);
        console.log(`   Content: "${message.content.slice(0, 50)}"`);
        console.log(`   Registered handlers: ${Array.from(this.handlers.keys()).join(', ') || 'none'}`);

        // Broadcast to all processes
        this.broadcastChannel.postMessage(message);

        // Notify local handlers
        await this.notifyHandlers(message);

        return message;
    }

    /** Subscribe to messages */
    subscribe(agentId: string, handler: MessageHandler): void {
        this.handlers.set(agentId, handler);
        console.log(`📝 [MessageBus] Subscribed: ${agentId} (total handlers: ${this.handlers.size})`);
    }

    /** Unsubscribe from messages */
    unsubscribe(agentId: string): void {
        this.handlers.delete(agentId);
    }

    /** Get recent messages */
    getRecent(limit: number = 50): MessageData[] {
        const db = getDatabase();
        const rows = db.messages.findMany({
            orderBy: { timestamp: 'desc' },
            take: limit
        });

        return rows.map(row => this.rowToMessage(row)).reverse();
    }

    /** Get recent messages (sync for SSR - same as getRecent since SatiDB is sync) */
    getRecentSync(limit: number = 50): MessageData[] {
        return this.getRecent(limit);
    }

    /** Get messages by source */
    getBySource(source: MessageSource, limit: number = 50): MessageData[] {
        const db = getDatabase();
        const rows = db.messages.findMany({
            where: { source },
            orderBy: { timestamp: 'desc' },
            take: limit
        });

        return rows.map(row => this.rowToMessage(row)).reverse();
    }

    /** Convert DB row to MessageData */
    private rowToMessage(row: any): MessageData {
        return {
            id: row.messageId,
            source: row.source as MessageSource,
            sourceId: row.sourceId,
            userId: row.userId,
            content: row.content,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
            timestamp: row.timestamp,
        };
    }

    private async notifyHandlers(message: MessageData): Promise<void> {
        const promises = Array.from(this.handlers.values()).map(handler => {
            try {
                return handler(message);
            } catch (e) {
                console.error('Message handler error:', e);
            }
        });
        await Promise.allSettled(promises);
    }

    /** Close the message bus */
    close(): void {
        this.broadcastChannel.close();
    }
}
