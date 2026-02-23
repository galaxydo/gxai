// app/src/lib/types.ts — Shared client types

export interface AgentEvent {
    type: string
    iteration?: number
    elapsed?: number
    message?: string
    tool?: string
    params?: Record<string, any>
    result?: { success: boolean; output: string; error?: string }
    results?: Array<{ name: string; met: boolean; reason: string }>
    objectives?: Array<{ name: string; description: string; type: string; params: Record<string, string> }>
    error?: string
}

export interface AgentEntry {
    id: number
    name: string
    sessionId: string | null
    status: 'idle' | 'running'
    model?: string
}

export interface ScheduleEntry {
    id: string
    name: string
    scriptPath: string
    intervalSec: number
    nextRun: number
    lastRun?: number
    lastResult?: { success: boolean; output: string; error?: string }
}

export interface ObjectiveEntry {
    name: string
    description: string
    type: string
    met?: boolean
    reason?: string
}

export interface FileEntry {
    path: string
    action: 'read' | 'write'
}

export interface ToolCardEntry {
    el: HTMLElement
    name: string
    params: Record<string, any>
    result?: { success: boolean; output: string; error?: string }
}

export interface WorkspaceState {
    agents: AgentEntry[]
    activeAgentId: number | null
    objectives: ObjectiveEntry[]
    files: FileEntry[]
    schedules: ScheduleEntry[]
    isRunning: boolean
    activeSkills: Set<string>
    availableSkills: string[]
    activeTab: 'objectives' | 'files' | 'schedule'
}
