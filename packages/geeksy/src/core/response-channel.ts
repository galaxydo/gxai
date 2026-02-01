/**
 * Response Channel - Queues and sends responses back to message sources
 */

import { getDatabase, generateId, type GxResponse } from './database';

export interface ResponseData {
    id: string;
    messageId: string;
    agentId: string;
    agentName: string;
    content: string;
    targetSource: string;
    targetSourceId?: string;
    targetUserId?: string;
    status: 'pending' | 'sent' | 'failed';
    sentAt?: number;
    createdAt: number;
}

type ResponseHandler = (response: ResponseData) => Promise<void> | void;

export class ResponseChannel {
    private handlers: Map<string, ResponseHandler> = new Map();
    private broadcastChannel = new BroadcastChannel('geeksy-responses');

    constructor() {
        // Listen for responses from other processes
        this.broadcastChannel.onmessage = (event) => {
            const response = event.data as ResponseData;
            this.notifyHandlers(response);
        };
    }

    /** Queue a response to be sent */
    queue(
        messageId: string,
        agentId: string,
        agentName: string,
        content: string,
        target: { source: string; sourceId?: string; userId?: string }
    ): ResponseData {
        const db = getDatabase();
        const responseId = generateId('res');

        const response: ResponseData = {
            id: responseId,
            messageId,
            agentId,
            agentName,
            content,
            targetSource: target.source,
            targetSourceId: target.sourceId,
            targetUserId: target.userId,
            status: 'pending',
            createdAt: Date.now(),
        };

        db.responses.insert({
            responseId: response.id,
            messageId: response.messageId,
            agentId: response.agentId,
            agentName: response.agentName,
            content: response.content,
            targetSource: response.targetSource,
            targetSourceId: response.targetSourceId,
            targetUserId: response.targetUserId,
            status: response.status,
            createdAt: response.createdAt,
        });

        // Broadcast to response handlers
        this.broadcastChannel.postMessage(response);
        this.notifyHandlers(response);

        return response;
    }

    /** Send a response (alias for queue with simplified interface) */
    send(
        agentId: string,
        agentName: string,
        messageId: string,
        content: string,
        target: { userId?: string; source?: string }
    ): ResponseData {
        return this.queue(messageId, agentId, agentName, content, {
            source: target.source || 'direct',
            userId: target.userId,
        });
    }

    /** Mark a response as sent */
    markSent(responseId: string): void {
        const db = getDatabase();
        db.responses.update({ responseId }, { status: 'sent', sentAt: Date.now() });
    }

    /** Mark a response as failed */
    markFailed(responseId: string): void {
        const db = getDatabase();
        db.responses.update({ responseId }, { status: 'failed' });
    }

    /** Get pending responses for a source */
    getPending(source: string): ResponseData[] {
        const db = getDatabase();
        const rows = db.responses.find({ targetSource: source, status: 'pending' });
        return rows.map(row => this.rowToResponse(row));
    }

    /** Get all responses */
    getAll(limit: number = 100): ResponseData[] {
        const db = getDatabase();
        const rows = db.responses.findMany({
            orderBy: { createdAt: 'desc' },
            take: limit
        });
        return rows.map(row => this.rowToResponse(row)).reverse();
    }

    /** Get all responses (sync for SSR) */
    getAllSync(limit: number = 100): ResponseData[] {
        return this.getAll(limit);
    }

    /** Register a handler for outgoing responses */
    registerHandler(source: string, handler: ResponseHandler): void {
        this.handlers.set(source, handler);
    }

    /** Unregister a handler */
    unregisterHandler(source: string): void {
        this.handlers.delete(source);
    }

    /** Notify handlers of a response */
    private async notifyHandlers(response: ResponseData): Promise<void> {
        const handler = this.handlers.get(response.targetSource);
        if (handler) {
            try {
                await handler(response);
                this.markSent(response.id);
            } catch (e) {
                console.error('Response handler error:', e);
                this.markFailed(response.id);
            }
        }
    }

    /** Convert DB row to ResponseData */
    private rowToResponse(row: any): ResponseData {
        return {
            id: row.responseId,
            messageId: row.messageId,
            agentId: row.agentId,
            agentName: row.agentName,
            content: row.content,
            targetSource: row.targetSource,
            targetSourceId: row.targetSourceId,
            targetUserId: row.targetUserId,
            status: row.status as ResponseData['status'],
            sentAt: row.sentAt,
            createdAt: row.createdAt,
        };
    }

    /** Close the response channel */
    close(): void {
        this.broadcastChannel.close();
    }
}
