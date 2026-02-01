/**
 * Geeksy Database - SatiDB-powered persistence layer
 * 
 * Uses Zod schemas for type safety and SQLite for storage
 */

import { z } from 'zod';
import { SatiDB } from 'satidb';

// ============================================
// Schema Definitions
// ============================================

export const MessageSchema = z.object({
    id: z.number().optional(),
    messageId: z.string(),          // External ID (msg_xxx)
    source: z.string(),
    sourceId: z.string().optional(),
    userId: z.string().optional(),
    content: z.string(),
    metadata: z.string().optional(), // JSON stringified
    timestamp: z.number(),
});

export const AgentSchema = z.object({
    id: z.number().optional(),
    agentId: z.string(),            // External ID (agent name)
    name: z.string(),
    description: z.string(),
    emoji: z.string(),
    port: z.number(),
    scriptPath: z.string(),
    capabilities: z.string(),       // JSON stringified array
    running: z.boolean().default(false),
    pid: z.number().optional(),
    lastActivity: z.number().optional(),
});

export const JobSchema = z.object({
    id: z.number().optional(),
    jobId: z.string(),              // External ID (job_xxx)
    messageId: z.string(),           // Reference to message
    agentId: z.string(),
    agentName: z.string(),
    agentEmoji: z.string(),
    status: z.string(),              // pending, processing, awaiting_callback, completed, failed
    decision: z.string(),            // handle, respond, spawn, ignore
    reason: z.string(),
    result: z.string().optional(),   // JSON stringified
    error: z.string().optional(),
    awaitingCallbackType: z.string().optional(),
    awaitingCallbackData: z.string().optional(), // JSON stringified
    startedAt: z.number(),
    completedAt: z.number().optional(),
    logs: z.string().default('[]'),  // JSON stringified array
});

export const ChannelSchema = z.object({
    id: z.number().optional(),
    channelId: z.string(),           // External ID
    name: z.string(),
    type: z.string(),                // telegram, discord, webhook, api, test
    emoji: z.string(),
    enabled: z.boolean().default(true),
    config: z.string().default('{}'), // JSON stringified
    messageCount: z.number().default(0),
    lastMessageAt: z.number().optional(),
    createdAt: z.number(),
});

export const ActivitySchema = z.object({
    id: z.number().optional(),
    eventId: z.string(),             // External ID
    agentId: z.string(),
    agentName: z.string(),
    agentEmoji: z.string(),
    action: z.string(),              // handle, ignore, spawn, respond, error
    summary: z.string(),
    messageId: z.string().optional(),
    details: z.string().optional(),  // JSON stringified
    timestamp: z.number(),
});

export const ResponseSchema = z.object({
    id: z.number().optional(),
    responseId: z.string(),          // External ID
    messageId: z.string(),
    agentId: z.string(),
    agentName: z.string(),
    content: z.string(),
    targetSource: z.string(),
    targetSourceId: z.string().optional(),
    targetUserId: z.string().optional(),
    status: z.string().default('pending'), // pending, sent, failed
    sentAt: z.number().optional(),
    createdAt: z.number(),
});

export const OnboardingSchema = z.object({
    id: z.number().optional(),
    stateId: z.string(),              // 'main' for primary onboarding
    currentStep: z.string(),          // welcome, select-messaging, etc.
    messagingMethod: z.string().optional(),    // telegram-account, telegram-bot, twitter-api, discord
    messagingConfig: z.string().optional(),    // JSON stringified config
    adminUserId: z.string().optional(),
    adminUsername: z.string().optional(),
    contacts: z.string().optional(),           // JSON stringified array
    selectedAgents: z.string().default('[]'),  // JSON stringified array
    completedAt: z.number().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
});

// ============================================
// Database Instance
// ============================================

const schemas = {
    messages: MessageSchema,
    agents: AgentSchema,
    jobs: JobSchema,
    channels: ChannelSchema,
    activities: ActivitySchema,
    responses: ResponseSchema,
    onboarding: OnboardingSchema,
};

type GeeksyDB = SatiDB<typeof schemas>;

let db: GeeksyDB | null = null;

export function getDatabase(): GeeksyDB {
    if (!db) {
        db = new SatiDB('.geeksy/geeksy.db', schemas);
    }
    return db;
}

// ============================================
// Type-safe accessors with external ID handling
// ============================================

export type Message = z.infer<typeof MessageSchema>;
export type Agent = z.infer<typeof AgentSchema>;
export type Job = z.infer<typeof JobSchema>;
export type Channel = z.infer<typeof ChannelSchema>;
export type Activity = z.infer<typeof ActivitySchema>;
export type GxResponse = z.infer<typeof ResponseSchema>;

// Helper to generate external IDs
export function generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

// Helper to parse JSON fields
export function parseJSON<T>(value: string | undefined, defaultValue: T): T {
    if (!value) return defaultValue;
    try {
        return JSON.parse(value);
    } catch {
        return defaultValue;
    }
}

// Helper to stringify JSON fields
export function stringifyJSON(value: any): string {
    return JSON.stringify(value);
}
