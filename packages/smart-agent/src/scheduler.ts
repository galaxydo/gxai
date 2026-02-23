// smart-agent/src/scheduler.ts
// Simple in-process task scheduler — runs scripts on intervals

export interface ScheduledTask {
    id: string
    name: string
    /** The script file to execute */
    scriptPath: string
    /** Interval in seconds */
    intervalSec: number
    /** Working directory */
    cwd: string
    /** When the task was created */
    createdAt: number
    /** When the task last ran */
    lastRun?: number
    /** When the task will next run */
    nextRun: number
    /** Last execution result */
    lastResult?: { success: boolean; output: string; error?: string }
    /** Internal timer handle */
    _timer?: ReturnType<typeof setInterval>
}

// Global task registry
const tasks = new Map<string, ScheduledTask>()

/** Schedule a script to run on an interval */
export function scheduleTask(opts: {
    name: string
    scriptPath: string
    intervalSec: number
    cwd: string
}): ScheduledTask {
    const id = `task_${Date.now().toString(36)}`
    const now = Date.now()

    const task: ScheduledTask = {
        id,
        name: opts.name,
        scriptPath: opts.scriptPath,
        intervalSec: opts.intervalSec,
        cwd: opts.cwd,
        createdAt: now,
        nextRun: now + opts.intervalSec * 1000,
    }

    // Start the interval
    task._timer = setInterval(async () => {
        task.lastRun = Date.now()
        task.nextRun = Date.now() + task.intervalSec * 1000

        try {
            const proc = Bun.spawn(["bun", "run", task.scriptPath], {
                cwd: task.cwd,
                stdout: "pipe",
                stderr: "pipe",
                env: { ...process.env },
            })

            const stdout = await new Response(proc.stdout).text()
            const stderr = await new Response(proc.stderr).text()
            const exitCode = await proc.exited

            task.lastResult = {
                success: exitCode === 0,
                output: (stdout + (stderr ? `\n[stderr] ${stderr}` : "")).substring(0, 2000),
                error: exitCode !== 0 ? `Exit code ${exitCode}` : undefined,
            }
        } catch (e: any) {
            task.lastResult = {
                success: false,
                output: "",
                error: e.message,
            }
        }
    }, opts.intervalSec * 1000)

    tasks.set(id, task)
    return task
}

/** Remove a scheduled task */
export function removeTask(id: string): boolean {
    const task = tasks.get(id)
    if (!task) return false
    if (task._timer) clearInterval(task._timer)
    tasks.delete(id)
    return true
}

/** List all scheduled tasks (without internal timer handle) */
export function listTasks(): Array<Omit<ScheduledTask, '_timer'>> {
    return Array.from(tasks.values()).map(({ _timer, ...rest }) => rest)
}

/** Get a specific task */
export function getTask(id: string): Omit<ScheduledTask, '_timer'> | undefined {
    const task = tasks.get(id)
    if (!task) return undefined
    const { _timer, ...rest } = task
    return rest
}
