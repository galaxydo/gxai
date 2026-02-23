// smart-agent/src/db.ts
// Server-side persistence via sqlite-zod-orm
import { Database, z } from 'sqlite-zod-orm'
import { measure, measureSync } from 'measure-fn'
import { join } from 'path'

// ── Schemas ──

const AgentSchema = z.object({
    name: z.string(),
    model: z.string().default('gemini-2.5-flash'),
    status: z.string().default('idle'),
    sessionId: z.string().optional(),
    config: z.object({}).passthrough().default({}),
})

const MessageSchema = z.object({
    agentId: z.number(),
    role: z.enum(['user', 'assistant', 'system', 'tool']),
    content: z.string(),
    type: z.string().default('text'), // text, card, divider
    metadata: z.object({}).passthrough().default({}),
})

const ObjectiveSchema = z.object({
    agentId: z.number(),
    name: z.string(),
    description: z.string().default(''),
    status: z.string().default('pending'), // pending, running, complete, failed
    result: z.string().optional(),
})

const FileSchema = z.object({
    agentId: z.number(),
    path: z.string(),
    action: z.string().default('created'), // created, modified, deleted
})

// ── Database ──

const DB_PATH = join(process.cwd(), 'smart-agent.db')

let _db: ReturnType<typeof createDB> | null = null

function createDB() {
    return new Database(DB_PATH, {
        agents: AgentSchema,
        messages: MessageSchema,
        objectives: ObjectiveSchema,
        files: FileSchema,
    }, {
        timestamps: true,
        indexes: {
            messages: ['agentId', 'role'],
            objectives: ['agentId', 'status'],
            files: ['agentId'],
        },
        relations: {
            messages: { agentId: 'agents' },
            objectives: { agentId: 'agents' },
            files: { agentId: 'agents' },
        },
        cascade: {
            agents: ['messages', 'objectives', 'files'],
        },
    })
}

export function getDB() {
    if (!_db) {
        _db = measureSync('Init database', () => createDB())!
    }
    return _db!
}

// ── Agent CRUD ──

export function createAgent(name: string, model = 'gemini-2.5-flash') {
    return measureSync('Create agent', () =>
        getDB().agents.insert({ name, model })
    )!
}

export function listAgents() {
    return measureSync('List agents', () =>
        getDB().agents.select().orderBy('id', 'desc').all()
    )!
}

export function getAgent(id: number) {
    return getDB().agents.select().where({ id }).first()
}

export function updateAgent(id: number, data: Record<string, any>) {
    return measureSync('Update agent', () =>
        getDB().agents.update(id, data)
    )
}

export function deleteAgentById(id: number) {
    return measureSync('Delete agent', () =>
        getDB().agents.delete(id)
    )
}

// ── Message CRUD ──

export function addMessage(agentId: number, role: string, content: string, type = 'text', metadata = {}) {
    return getDB().messages.insert({
        agentId,
        role: role as any,
        content,
        type,
        metadata,
    })
}

export function getMessages(agentId: number) {
    return getDB().messages.select()
        .where({ agentId })
        .orderBy('id', 'asc')
        .all()
}

export function clearMessages(agentId: number) {
    return measureSync('Clear messages', () =>
        getDB().messages.delete().where({ agentId }).exec()
    )
}

// ── Objective CRUD ──

export function setObjectives(agentId: number, objectives: Array<{ name: string; description: string; status?: string }>) {
    const db = getDB()
    return db.transaction(() => {
        // Clear old objectives
        db.objectives.delete().where({ agentId }).exec()
        // Insert new ones
        for (const obj of objectives) {
            db.objectives.insert({
                agentId,
                name: obj.name,
                description: obj.description,
                status: obj.status || 'pending',
            })
        }
    })
}

export function getObjectives(agentId: number) {
    return getDB().objectives.select()
        .where({ agentId })
        .orderBy('id', 'asc')
        .all()
}

export function updateObjective(id: number, data: Record<string, any>) {
    return getDB().objectives.update(id, data)
}

// ── File tracking ──

export function trackFile(agentId: number, path: string, action = 'created') {
    return getDB().files.insert({ agentId, path, action })
}

export function getFiles(agentId: number) {
    return getDB().files.select()
        .where({ agentId })
        .orderBy('id', 'asc')
        .all()
}

export function clearFiles(agentId: number) {
    return getDB().files.delete().where({ agentId }).exec()
}
