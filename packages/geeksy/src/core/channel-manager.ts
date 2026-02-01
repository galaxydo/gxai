/**
 * Channel Manager - Manages incoming message channels
 * 
 * Channels are different sources of incoming messages:
 * - Telegram Bot
 * - Discord Bot
 * - Webhook endpoints
 * - API calls
 * - Test UI
 */

import { getDatabase, generateId, stringifyJSON, parseJSON } from './database';

export type ChannelType = 'telegram' | 'discord' | 'webhook' | 'api' | 'test';

export interface ChannelData {
    id: string;
    name: string;
    type: ChannelType;
    emoji: string;
    enabled: boolean;
    config: Record<string, any>;  // Type-specific configuration
    messageCount: number;
    lastMessageAt?: number;
    createdAt: number;
}

export class ChannelManager {
    private broadcastChannel = new BroadcastChannel('geeksy-channels');

    constructor() { }

    /** Create a new channel */
    create(
        name: string,
        type: ChannelType,
        emoji: string,
        config: Record<string, any> = {}
    ): ChannelData {
        const db = getDatabase();
        const channelId = generateId('ch');

        const channel: ChannelData = {
            id: channelId,
            name,
            type,
            emoji,
            enabled: true,
            config,
            messageCount: 0,
            createdAt: Date.now(),
        };

        db.channels.insert({
            channelId: channel.id,
            name: channel.name,
            type: channel.type,
            emoji: channel.emoji,
            enabled: channel.enabled,
            config: stringifyJSON(channel.config),
            messageCount: channel.messageCount,
            createdAt: channel.createdAt,
        });

        this.broadcastChannel.postMessage({ action: 'created', channel });
        return channel;
    }

    /** Update a channel */
    update(channelId: string, updates: Partial<Omit<ChannelData, 'id' | 'createdAt'>>): ChannelData | null {
        const db = getDatabase();
        const row = db.channels.findOne({ channelId });
        if (!row) return null;

        const dbUpdates: any = {};
        if (updates.name !== undefined) dbUpdates.name = updates.name;
        if (updates.type !== undefined) dbUpdates.type = updates.type;
        if (updates.emoji !== undefined) dbUpdates.emoji = updates.emoji;
        if (updates.enabled !== undefined) dbUpdates.enabled = updates.enabled;
        if (updates.config !== undefined) dbUpdates.config = stringifyJSON(updates.config);
        if (updates.messageCount !== undefined) dbUpdates.messageCount = updates.messageCount;
        if (updates.lastMessageAt !== undefined) dbUpdates.lastMessageAt = updates.lastMessageAt;

        db.channels.update({ channelId }, dbUpdates);

        const updatedRow = db.channels.findOne({ channelId });
        if (!updatedRow) return null;

        const channel = this.rowToChannel(updatedRow);
        this.broadcastChannel.postMessage({ action: 'updated', channel });
        return channel;
    }

    /** Toggle channel enabled state */
    toggle(channelId: string): ChannelData | null {
        const db = getDatabase();
        const row = db.channels.findOne({ channelId });
        if (!row) return null;

        return this.update(channelId, { enabled: !row.enabled });
    }

    /** Delete a channel */
    delete(channelId: string): boolean {
        const db = getDatabase();
        const row = db.channels.findOne({ channelId });
        if (!row) return false;

        db.channels.delete(row.id);
        this.broadcastChannel.postMessage({ action: 'deleted', channelId });
        return true;
    }

    /** Record a message received from a channel */
    recordMessage(channelId: string): void {
        const db = getDatabase();
        const row = db.channels.findOne({ channelId });
        if (!row) return;

        db.channels.update({ channelId }, {
            messageCount: row.messageCount + 1,
            lastMessageAt: Date.now()
        });
    }

    /** Get all channels */
    getAll(): ChannelData[] {
        const db = getDatabase();
        const rows = db.channels.find();
        return rows.map(row => this.rowToChannel(row));
    }

    /** Get all channels (sync for SSR) */
    getAllSync(): ChannelData[] {
        return this.getAll();
    }

    /** Get enabled channels */
    getEnabled(): ChannelData[] {
        const db = getDatabase();
        const rows = db.channels.find({ enabled: true });
        return rows.map(row => this.rowToChannel(row));
    }

    /** Get channel by ID */
    getById(channelId: string): ChannelData | null {
        const db = getDatabase();
        const row = db.channels.findOne({ channelId });
        return row ? this.rowToChannel(row) : null;
    }

    /** Get channels by type */
    getByType(type: ChannelType): ChannelData[] {
        const db = getDatabase();
        const rows = db.channels.find({ type });
        return rows.map(row => this.rowToChannel(row));
    }

    /** Convert DB row to ChannelData */
    private rowToChannel(row: any): ChannelData {
        return {
            id: row.channelId,
            name: row.name,
            type: row.type as ChannelType,
            emoji: row.emoji,
            enabled: row.enabled,
            config: parseJSON(row.config, {}),
            messageCount: row.messageCount,
            lastMessageAt: row.lastMessageAt,
            createdAt: row.createdAt,
        };
    }

    close(): void {
        this.broadcastChannel.close();
    }
}
