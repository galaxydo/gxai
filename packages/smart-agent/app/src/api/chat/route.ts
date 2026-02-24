// app/src/api/chat/route.ts — SSE streaming endpoint with Session pipeline
import { measure, measureSync } from "measure-fn"
import { Session } from "../../../../src"
import type { AgentConfig } from "../../../../src"
// DB persistence stub (db module was removed)
const addMessage = (_agentId: number, _role: string, _content: string) => { }
import { join } from "path"
import { readdirSync } from "fs"

// Ensure saved API keys are loaded into process.env
import '../models/route'

const skillsDir = join(import.meta.dir, "../../../../skills")

// In-memory session store (keyed by session ID)
const sessions = new Map<string, Session>()

/** DELETE /api/chat?sessionId=x — abort a running session */
export async function DELETE(req: Request) {
    const url = new URL(req.url)
    const sessionId = url.searchParams.get("sessionId")
    if (!sessionId) return Response.json({ error: "Missing sessionId" }, { status: 400 })

    const session = sessions.get(sessionId)
    if (!session) return Response.json({ error: "Session not found" }, { status: 404 })

    session.abort()
    return Response.json({ ok: true })
}

/** PUT /api/chat — confirm or reject objectives */
export async function PUT(req: Request) {
    const { sessionId, confirmed } = await req.json() as { sessionId: string; confirmed: boolean }
    if (!sessionId) return Response.json({ error: "Missing sessionId" }, { status: 400 })

    const session = sessions.get(sessionId)
    if (!session) return Response.json({ error: "Session not found" }, { status: 404 })

    if (!session.isAwaitingConfirmation) {
        return Response.json({ error: "Session is not awaiting confirmation" }, { status: 400 })
    }

    if (confirmed) {
        session.confirmObjectives()
    } else {
        session.rejectObjectives()
    }

    return Response.json({ ok: true })
}

export async function POST(req: Request) {
    const body = await measure('Parse request', () => req.json()) as {
        message: string
        model?: string
        skills?: string[]
        cwd?: string
        sessionId?: string
        agentId?: number
    }

    const model = body.model || "gemini-2.5-flash"
    const cwd = body.cwd || process.cwd()

    // Validate API key early
    const hasKey = !!(
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_API_KEY ||
        process.env.ANTHROPIC_API_KEY ||
        process.env.OPENAI_API_KEY
    )

    if (!hasKey) {
        const stream = new ReadableStream({
            start(controller) {
                const enc = new TextEncoder()
                controller.enqueue(enc.encode(`event: error\ndata: ${JSON.stringify({ type: "error", iteration: -1, error: "No API key found. Set GEMINI_API_KEY, GOOGLE_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY." })}\n\n`))
                controller.enqueue(enc.encode(`event: done\ndata: {}\n\n`))
                controller.close()
            }
        })
        return new Response(stream, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            }
        })
    }

    // Resolve skill paths
    const skillPaths = measureSync('Resolve skill paths', () =>
        (body.skills || []).map(s => join(skillsDir, `${s}.yaml`))
    )!

    const config: AgentConfig = {
        model,
        cwd,
        skills: skillPaths.length > 0 ? skillPaths : undefined,
        maxIterations: 10,
    }

    // Get or create session
    const session = measureSync('Resolve session', () => {
        if (body.sessionId && sessions.has(body.sessionId)) {
            return sessions.get(body.sessionId)!
        }
        const s = new Session(config)
        sessions.set(s.id, s)
        return s
    })!

    // Create SSE stream
    const stream = new ReadableStream({
        async start(controller) {
            const enc = new TextEncoder()

            // Persist user message to DB
            if (body.agentId) {
                addMessage(body.agentId, 'user', body.message)
            }

            // Emit session ID
            controller.enqueue(enc.encode(`event: session\ndata: ${JSON.stringify({ sessionId: session.id })}\n\n`))

            try {
                let eventCount = 0
                let assistantText = ''
                for await (const event of session.send(body.message)) {
                    eventCount++
                    controller.enqueue(enc.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`))

                    // Accumulate assistant response text
                    if (event.type === 'thinking_delta') assistantText += (event as any).delta || ''
                }

                // Persist assistant response
                if (body.agentId && assistantText) {
                    addMessage(body.agentId, 'assistant', assistantText)
                }

                measureSync(`SSE complete (${eventCount} events)`)
                controller.enqueue(enc.encode(`event: done\ndata: {}\n\n`))
            } catch (err: any) {
                console.error("[chat] Error:", err)
                controller.enqueue(enc.encode(`event: error\ndata: ${JSON.stringify({ type: "error", iteration: -1, error: err.message || String(err) })}\n\n`))
                controller.enqueue(enc.encode(`event: done\ndata: {}\n\n`))
            } finally {
                controller.close()
            }
        }
    })

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    })
}

// List available skills
export async function GET() {
    const skills = measureSync('List skills', () => {
        const result: string[] = []
        try {
            for (const f of readdirSync(skillsDir)) {
                if (f.endsWith(".yaml") || f.endsWith(".yml")) {
                    result.push(f.replace(/\.(yaml|yml)$/, ""))
                }
            }
        } catch { }
        return result
    })
    return Response.json(skills)
}
