// app/src/api/agents/route.ts — CRUD API for agents
import { measure, measureSync } from 'measure-fn'
import {
    createAgent, listAgents, getAgent, updateAgent, deleteAgentById,
    getMessages, addMessage, clearMessages,
    getObjectives, setObjectives,
    getFiles, clearFiles,
} from '../../../../src/db'

/** GET /api/agents — list all agents */
export async function GET() {
    const agents = listAgents()
    return Response.json(agents)
}

/** POST /api/agents — create agent */
export async function POST(req: Request) {
    const body = await req.json() as { name?: string; model?: string }
    const agent = createAgent(body.name || 'New Agent', body.model)
    return Response.json(agent)
}

/** PUT /api/agents?id=x — update agent */
export async function PUT(req: Request) {
    const url = new URL(req.url)
    const id = Number(url.searchParams.get('id'))
    if (!id) return Response.json({ error: 'Missing id' }, { status: 400 })

    const body = await req.json()
    updateAgent(id, body)
    const updated = getAgent(id)
    return Response.json(updated)
}

/** DELETE /api/agents?id=x — delete agent (cascade deletes messages/objectives/files) */
export async function DELETE(req: Request) {
    const url = new URL(req.url)
    const id = Number(url.searchParams.get('id'))
    if (!id) return Response.json({ error: 'Missing id' }, { status: 400 })

    deleteAgentById(id)
    return Response.json({ ok: true })
}
