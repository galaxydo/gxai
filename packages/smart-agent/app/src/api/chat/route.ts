// app/src/api/chat/route.ts — SSE streaming endpoint with Session pipeline
import { measure, measureSync } from "measure-fn"
import { Session } from "../../../../src"
import type { AgentConfig } from "../../../../src"
import { join } from "path"
import { readdirSync } from "fs"

const skillsDir = join(import.meta.dir, "../../../../skills")

// In-memory session store (keyed by session ID)
const sessions = new Map<string, Session>()

export async function* POST(req: Request) {
    const body = await measure('Parse request', () => req.json()) as {
        message: string
        model?: string
        skills?: string[]
        cwd?: string
        sessionId?: string
    }

    const model = body.model || "gemini-3-flash-preview"
    const cwd = body.cwd || process.cwd()

    // Validate API key early
    const hasKey = !!(
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_API_KEY ||
        process.env.ANTHROPIC_API_KEY ||
        process.env.OPENAI_API_KEY
    )
    if (!hasKey) {
        yield `event: error\ndata: ${JSON.stringify({ type: "error", iteration: -1, error: "No API key found. Set GEMINI_API_KEY, GOOGLE_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY." })}\n\n`
        yield `event: done\ndata: {}\n\n`
        return
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

    // Emit session ID so client can track it
    yield `event: session\ndata: ${JSON.stringify({ sessionId: session.id })}\n\n`

    try {
        let eventCount = 0
        for await (const event of session.send(body.message)) {
            eventCount++
            yield `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
        }
        measureSync(`SSE complete (${eventCount} events)`)
        yield `event: done\ndata: {}\n\n`
    } catch (err: any) {
        console.error("[chat] Error:", err)
        yield `event: error\ndata: ${JSON.stringify({ type: "error", iteration: -1, error: err.message || String(err) })}\n\n`
        yield `event: done\ndata: {}\n\n`
    }
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
