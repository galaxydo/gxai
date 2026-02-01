/**
 * Geeksy Core Schemas - Extended SatiDB schemas for the new architecture
 * 
 * Architecture:
 * - Contacts: People our assistant interacts with, each can have agents attached
 * - Agents: Code templates that process messages, can be created dynamically
 * - Jobs: Execution instances triggered by contact messages
 * - Auth: Telegram account connection status
 */

import { z } from 'zod';
import { SatiDB } from 'satidb';

// ============================================
// Auth Schema - Telegram account connection
// ============================================

export const AuthSchema = z.object({
    id: z.number().optional(),
    authId: z.string(),                // 'main' for primary auth
    type: z.string(),                   // 'telegram-account', 'telegram-bot', etc
    status: z.string(),                 // 'disconnected', 'pending', 'connected'
    phoneNumber: z.string().optional(),
    sessionString: z.string().optional(), // Encrypted telegram session
    userId: z.string().optional(),      // Telegram user ID when connected
    username: z.string().optional(),    // Telegram username when connected  
    firstName: z.string().optional(),
    lastConnectedAt: z.number().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
});

// ============================================
// Contact Schema - People we interact with
// ============================================

export const ContactSchema = z.object({
    id: z.number().optional(),
    contactId: z.string(),              // External ID (contact_xxx)
    telegramId: z.string().optional(),  // Telegram user ID
    telegramUsername: z.string().optional(),
    firstName: z.string(),
    lastName: z.string().optional(),
    displayName: z.string(),            // Computed display name
    avatarUrl: z.string().optional(),
    hidden: z.boolean().default(false), // Hidden from main list
    messageCount: z.number().default(0),
    lastMessageAt: z.number().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
});

// ============================================
// Agent Schema - Code templates for processing
// ============================================

export const AgentCodeSchema = z.object({
    id: z.number().optional(),
    agentId: z.string(),                // External ID (agent_xxx)
    name: z.string(),
    emoji: z.string(),
    description: z.string(),
    code: z.string(),                   // TypeScript code to execute
    systemPrompt: z.string().optional(), // Optional LLM system prompt
    version: z.number().default(1),
    enabled: z.boolean().default(true),
    // Meta-agent capabilities
    canCreateAgents: z.boolean().default(false),
    canAttachContacts: z.boolean().default(false),
    canSendMessages: z.boolean().default(false),
    // Stats
    contactCount: z.number().default(0),  // Contacts using this agent
    jobCount: z.number().default(0),      // Jobs executed
    successCount: z.number().default(0),
    failureCount: z.number().default(0),
    createdByAgentId: z.string().optional(), // If created by meta-agent
    createdAt: z.number(),
    updatedAt: z.number(),
});

// ============================================
// Contact-Agent Binding - Which agents handle which contacts
// ============================================

export const ContactAgentSchema = z.object({
    id: z.number().optional(),
    bindingId: z.string(),              // External ID
    contactId: z.string(),              // Reference to contact
    agentId: z.string(),                // Reference to agent
    priority: z.number().default(0),    // Higher = runs first
    enabled: z.boolean().default(true),
    createdAt: z.number(),
});

// ============================================
// Message History Schema - Per-contact message storage
// ============================================

export const MessageHistorySchema = z.object({
    id: z.number().optional(),
    messageId: z.string(),              // External ID
    contactId: z.string(),              // Which contact this is from/to
    direction: z.string(),              // 'incoming' or 'outgoing'
    content: z.string(),
    metadata: z.string().optional(),    // JSON stringified extra data
    jobId: z.string().optional(),       // Job that sent this (for outgoing)
    timestamp: z.number(),
});

// ============================================
// Job Execution Schema - Runtime instances
// ============================================

export const JobExecutionSchema = z.object({
    id: z.number().optional(),
    jobId: z.string(),                  // External ID (job_xxx)
    agentId: z.string(),                // Which agent's code is running
    agentName: z.string(),
    agentEmoji: z.string(),
    contactId: z.string(),              // Which contact triggered this
    messageId: z.string(),              // The triggering message
    status: z.string(),                 // 'pending', 'running', 'inference', 'sending', 'completed', 'failed'
    inferenceSteps: z.number().default(0), // How many LLM calls made
    responseMessage: z.string().optional(), // What was sent back
    error: z.string().optional(),
    logs: z.string().default('[]'),     // JSON array of execution logs
    durationMs: z.number().optional(),
    startedAt: z.number(),
    completedAt: z.number().optional(),
});

// ============================================
// Database Instance
// ============================================

const schemas = {
    auth: AuthSchema,
    contacts: ContactSchema,
    agents: AgentCodeSchema,
    contactAgents: ContactAgentSchema,
    messageHistory: MessageHistorySchema,
    jobExecutions: JobExecutionSchema,
};

type GeeksyNewDB = SatiDB<typeof schemas>;

let newDb: GeeksyNewDB | null = null;

export function getNewDatabase(): GeeksyNewDB {
    if (!newDb) {
        newDb = new SatiDB('.geeksy/geeksy-new.db', schemas);
    }
    return newDb;
}

// ============================================
// Types
// ============================================

export type Auth = z.infer<typeof AuthSchema>;
export type Contact = z.infer<typeof ContactSchema>;
export type AgentCode = z.infer<typeof AgentCodeSchema>;
export type ContactAgent = z.infer<typeof ContactAgentSchema>;
export type MessageHistory = z.infer<typeof MessageHistorySchema>;
export type JobExecution = z.infer<typeof JobExecutionSchema>;

// ============================================
// Helpers
// ============================================

export function generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}
