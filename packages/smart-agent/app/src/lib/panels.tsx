// app/src/lib/panels.tsx — Overview panes: Objectives, Files, Schedule
import { render } from 'melina/client'
import { state, dom } from './state'

// ══════════════════════════════════════
// OBJECTIVES
// ══════════════════════════════════════

function ObjectiveItem({ obj }: { obj: { name: string; description: string; met?: boolean; reason?: string } }) {
    const status = obj.met === undefined ? '' : obj.met ? 'met' : 'unmet'
    const icon = obj.met === undefined ? '⏳' : obj.met ? '✅' : '❌'
    return (
        <div className={`obj-item ${status}`} data-obj={obj.name}>
            <span className="obj-icon">{icon}</span>
            <div className="obj-info">
                <span className="obj-name">{obj.name}</span>
                <span className="obj-desc">{obj.description}</span>
                {obj.reason && <span className="obj-reason">{obj.reason}</span>}
            </div>
        </div>
    )
}

export function renderObjectivesPane() {
    const pane = document.getElementById('pane-objectives')!
    if (state.objectives.length === 0) {
        render(<div className="overview-empty">No objectives yet. Send a message to start planning.</div>, pane)
    } else {
        render(
            <div className="obj-grid">
                {state.objectives.map(o => <ObjectiveItem obj={o} />)}
            </div>,
            pane
        )
    }
}

export function updateObjectives(results: Array<{ name: string; met: boolean; reason: string }>) {
    for (const r of results) {
        const obj = state.objectives.find(o => o.name === r.name)
        if (obj) {
            obj.met = r.met
            obj.reason = r.reason
        }
    }
    renderObjectivesPane()
}

// ══════════════════════════════════════
// FILES
// ══════════════════════════════════════

export function renderFilesPane() {
    const pane = document.getElementById('pane-files')!
    if (state.files.length === 0) {
        render(<div className="overview-empty">No files touched yet.</div>, pane)
    } else {
        render(
            <div className="file-list">
                {state.files.map(f => (
                    <div className="file-item">
                        <span className="file-icon">{f.action === 'write' ? '📝' : '📄'}</span>
                        <span className="file-path">{f.path}</span>
                        <span className={`file-action ${f.action}`}>{f.action}</span>
                    </div>
                ))}
            </div>,
            pane
        )
    }
}

// ══════════════════════════════════════
// SCHEDULE
// ══════════════════════════════════════

let schedulePoller: ReturnType<typeof setInterval> | null = null

export async function fetchSchedules() {
    try {
        const res = await fetch('/api/schedule')
        if (res.ok) {
            state.schedules = await res.json()
            renderSchedulePane()
        }
    } catch { /* ignore */ }
}

export function startSchedulePolling() {
    if (schedulePoller) return
    fetchSchedules()
    schedulePoller = setInterval(fetchSchedules, 5000)
}

export function stopSchedulePolling() {
    if (schedulePoller) { clearInterval(schedulePoller); schedulePoller = null }
}

function formatTimeUntil(ts: number): string {
    const diff = Math.max(0, ts - Date.now())
    const sec = Math.floor(diff / 1000)
    if (sec < 60) return `${sec}s`
    const min = Math.floor(sec / 60)
    return `${min}m ${sec % 60}s`
}

export function renderSchedulePane() {
    const pane = document.getElementById('pane-schedule')!
    if (state.schedules.length === 0) {
        render(<div className="overview-empty">No scheduled tasks yet.</div>, pane)
    } else {
        render(
            <div className="schedule-list">
                {state.schedules.map(s => (
                    <div className="schedule-item" key={s.id}>
                        <div className="schedule-left">
                            <span className="schedule-icon">{'\u23F1'}</span>
                            <div className="schedule-info">
                                <div className="schedule-name">{s.name}</div>
                                <div className="schedule-meta">
                                    every {s.intervalSec}s · next in {formatTimeUntil(s.nextRun)}
                                </div>
                                <div className="schedule-script">{s.scriptPath.split(/[/\\]/).pop()}</div>
                            </div>
                        </div>
                        <div className="schedule-right">
                            {s.lastResult ? (
                                <span className={`schedule-status ${s.lastResult.success ? 'ok' : 'err'}`}>
                                    {s.lastResult.success ? '\u2713' : '\u2717'} {s.lastRun ? new Date(s.lastRun).toLocaleTimeString() : ''}
                                </span>
                            ) : (
                                <span className="schedule-status pending">pending</span>
                            )}
                            <button className="schedule-cancel" onClick={() => cancelTask(s.id)} title="Cancel task">{'\u2715'}</button>
                        </div>
                    </div>
                ))}
            </div>,
            pane
        )
    }
}

async function cancelTask(id: string) {
    await fetch(`/api/schedule?id=${id}`, { method: 'DELETE' })
    state.schedules = state.schedules.filter(s => s.id !== id)
    renderSchedulePane()
}

// ── Tab Switching ──

export function switchTab(tab: 'objectives' | 'files' | 'schedule') {
    state.activeTab = tab

    document.querySelectorAll('#tab-bar .tab').forEach(t => {
        t.classList.toggle('active', (t as HTMLElement).dataset.tab === tab)
    })

    document.querySelectorAll('.tab-pane').forEach(p => {
        p.classList.toggle('active', p.id === `pane-${tab}`)
    })

    if (tab === 'schedule') {
        startSchedulePolling()
    } else {
        stopSchedulePolling()
    }
}
