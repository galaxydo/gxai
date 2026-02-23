// app/src/api/schedule/route.ts — Schedule API for the Schedule tab
import { listTasks, removeTask } from "../../../../src"

/** GET /api/schedule — list all scheduled tasks */
export async function GET() {
    return Response.json(listTasks())
}

/** DELETE /api/schedule?id=xxx — remove a scheduled task */
export async function DELETE(req: Request) {
    const url = new URL(req.url)
    const id = url.searchParams.get("id")
    if (!id) return Response.json({ error: "Missing id" }, { status: 400 })

    const removed = removeTask(id)
    return removed
        ? Response.json({ ok: true })
        : Response.json({ error: "Task not found" }, { status: 404 })
}
