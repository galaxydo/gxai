// app/src/api/state/route.ts — Per-agent state API stub
// (db module was removed — returns empty stubs)

/** GET /api/state?agentId=x — full state for an agent */
export async function GET(req: Request) {
    const url = new URL(req.url)
    const agentId = Number(url.searchParams.get('agentId'))
    if (!agentId) return Response.json({ error: 'Missing agentId' }, { status: 400 })
    return Response.json({ messages: [], objectives: [], files: [] })
}

/** POST /api/state — save message, objective, or file */
export async function POST(req: Request) {
    return Response.json({ error: 'State persistence not implemented' }, { status: 501 })
}
