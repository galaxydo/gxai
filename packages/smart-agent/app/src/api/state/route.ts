// app/src/api/state/route.ts — Per-agent state API (messages, objectives, files)
import { measureSync } from 'measure-fn'
import {
    getMessages, addMessage, clearMessages,
    getObjectives, setObjectives, updateObjective,
    getFiles, trackFile, clearFiles,
} from '../../../../src/db'

/** GET /api/state?agentId=x — full state for an agent */
export async function GET(req: Request) {
    const url = new URL(req.url)
    const agentId = Number(url.searchParams.get('agentId'))
    if (!agentId) return Response.json({ error: 'Missing agentId' }, { status: 400 })

    const data = measureSync('Load agent state', () => ({
        messages: getMessages(agentId),
        objectives: getObjectives(agentId),
        files: getFiles(agentId),
    }))!

    return Response.json(data)
}

/** POST /api/state — save message, objective, or file */
export async function POST(req: Request) {
    const body = await req.json() as {
        action: string
        agentId: number
        [key: string]: any
    }

    switch (body.action) {
        case 'add_message':
            return Response.json(
                addMessage(body.agentId, body.role, body.content, body.type, body.metadata || {})
            )

        case 'set_objectives':
            setObjectives(body.agentId, body.objectives)
            return Response.json({ ok: true })

        case 'update_objective':
            updateObjective(body.objectiveId, body.data)
            return Response.json({ ok: true })

        case 'track_file':
            return Response.json(trackFile(body.agentId, body.path, body.fileAction))

        case 'clear':
            clearMessages(body.agentId)
            clearFiles(body.agentId)
            return Response.json({ ok: true })

        default:
            return Response.json({ error: `Unknown action: ${body.action}` }, { status: 400 })
    }
}
