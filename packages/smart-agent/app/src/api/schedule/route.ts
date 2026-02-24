// app/src/api/schedule/route.ts — Schedule API stub
// (listTasks/removeTask were removed from core — return empty stubs)

/** GET /api/schedule — list all scheduled tasks */
export async function GET() {
    return Response.json({})
}

/** DELETE /api/schedule?id=xxx — remove a scheduled task */
export async function DELETE(req: Request) {
    const url = new URL(req.url)
    const id = url.searchParams.get("id")
    if (!id) return Response.json({ error: "Missing id" }, { status: 400 })
    return Response.json({ error: "Scheduling not implemented" }, { status: 501 })
}
