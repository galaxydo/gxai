/**
 * Activity Stream - Logs agent activities and events
 */

import { getDatabase, generateId, stringifyJSON, parseJSON } from './database';

export type ActivityAction = 'handle' | 'ignore' | 'spawn' | 'respond' | 'error' | 'info';

export interface ActivityEvent {
    id: string;
    agentId: string;
    agentName: string;
    agentEmoji: string;
    action: ActivityAction;
    summary: string;
    messageId?: string;
    details?: any;
    timestamp: number;
}

export class ActivityStream {
    private broadcastChannel = new BroadcastChannel('geeksy-activities');

    constructor() { }

    /** Log an activity event */
    log(event: Omit<ActivityEvent, 'id' | 'timestamp'>): ActivityEvent {
        const db = getDatabase();
        const eventId = generateId('act');

        const fullEvent: ActivityEvent = {
            id: eventId,
            timestamp: Date.now(),
            ...event
        };

        db.activities.insert({
            eventId: fullEvent.id,
            agentId: fullEvent.agentId,
            agentName: fullEvent.agentName,
            agentEmoji: fullEvent.agentEmoji,
            action: fullEvent.action,
            summary: fullEvent.summary,
            messageId: fullEvent.messageId,
            details: fullEvent.details ? stringifyJSON(fullEvent.details) : undefined,
            timestamp: fullEvent.timestamp,
        });

        // Broadcast to other processes
        this.broadcastChannel.postMessage(fullEvent);

        return fullEvent;
    }

    /** Get recent activities */
    getRecent(limit: number = 50): ActivityEvent[] {
        const db = getDatabase();
        const rows = db.activities.findMany({
            orderBy: { timestamp: 'desc' },
            take: limit
        });

        return rows.map(row => this.rowToEvent(row)).reverse();
    }

    /** Get recent activities (sync for SSR) */
    getRecentSync(limit: number = 50): ActivityEvent[] {
        return this.getRecent(limit);
    }

    /** Get activities for an agent */
    getByAgent(agentId: string, limit: number = 50): ActivityEvent[] {
        const db = getDatabase();
        const rows = db.activities.findMany({
            where: { agentId },
            orderBy: { timestamp: 'desc' },
            take: limit
        });

        return rows.map(row => this.rowToEvent(row)).reverse();
    }

    /** Get activities for a message */
    getByMessage(messageId: string): ActivityEvent[] {
        const db = getDatabase();
        const rows = db.activities.find({ messageId });
        return rows.map(row => this.rowToEvent(row));
    }

    /** Convert DB row to ActivityEvent */
    private rowToEvent(row: any): ActivityEvent {
        return {
            id: row.eventId,
            agentId: row.agentId,
            agentName: row.agentName,
            agentEmoji: row.agentEmoji,
            action: row.action as ActivityAction,
            summary: row.summary,
            messageId: row.messageId,
            details: row.details ? parseJSON(row.details, null) : undefined,
            timestamp: row.timestamp,
        };
    }

    /** Close the activity stream */
    close(): void {
        this.broadcastChannel.close();
    }
}
