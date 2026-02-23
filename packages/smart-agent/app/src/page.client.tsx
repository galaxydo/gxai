// app/src/page.client.tsx — Client mount script for chat interactivity
import { render } from 'melina/client';

interface AgentEvent {
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

interface ChatState {
    messages: Array<{ type: 'user' | 'event'; content: any }>
    events: AgentEvent[]
    objectives: Array<{ name: string; description: string; type: string; met?: boolean; reason?: string }>
    isRunning: boolean
    activeSkills: Set<string>
    availableSkills: string[]
    sessionId: string | null
}

const state: ChatState = {
    messages: [],
    events: [],
    objectives: [],
    isRunning: false,
    activeSkills: new Set(),
    availableSkills: [],
    sessionId: null,
}

let chatArea: HTMLElement
let inputEl: HTMLTextAreaElement
let sendBtn: HTMLButtonElement
let modelSelect: HTMLSelectElement

export default function mount() {
    chatArea = document.getElementById('chat-area')!
    inputEl = document.getElementById('input') as HTMLTextAreaElement
    sendBtn = document.getElementById('send-btn') as HTMLButtonElement
    modelSelect = document.getElementById('model-select') as HTMLSelectElement

    // Load skills
    loadSkills()

    // Auto-resize textarea
    inputEl.addEventListener('input', () => {
        inputEl.style.height = 'auto'
        inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px'
    })

    // Enter to send
    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            sendMessage()
        }
    })

    sendBtn.addEventListener('click', sendMessage)

    // Example chip delegation
    document.addEventListener('click', (e) => {
        const chip = (e.target as HTMLElement).closest('[data-prompt]') as HTMLElement | null
        if (chip) {
            inputEl.value = chip.dataset.prompt || ''
            inputEl.dispatchEvent(new Event('input'))
            sendMessage()
        }
    })

    return () => { }
}

async function loadSkills() {
    try {
        const res = await fetch('/api/chat')
        state.availableSkills = await res.json()
        renderSkillChips()
    } catch { }
}

function renderSkillChips() {
    const container = document.getElementById('skill-toggles')
    if (!container) return
    render(
        <div className="skill-toggles">
            {state.availableSkills.map(skill => (
                <button
                    className={`skill-chip ${state.activeSkills.has(skill) ? 'active' : ''}`}
                    onClick={() => {
                        if (state.activeSkills.has(skill)) state.activeSkills.delete(skill)
                        else state.activeSkills.add(skill)
                        renderSkillChips()
                    }}
                >
                    {skill}
                </button>
            ))}
        </div>,
        container
    )
}

async function sendMessage() {
    const text = inputEl.value.trim()
    if (!text || state.isRunning) return

    state.isRunning = true
    sendBtn.setAttribute('disabled', 'true')
    inputEl.value = ''
    inputEl.style.height = 'auto'

    // Remove empty state
    const empty = document.getElementById('empty-state')
    if (empty) empty.remove()

    // Add user message
    appendUserBubble(text)

    // Add loading indicator
    const loadingEl = appendLoading()

    // SSE stream
    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: text,
                model: modelSelect.value,
                skills: [...state.activeSkills],
                sessionId: state.sessionId,
            }),
        })

        const reader = res.body!.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            let eventType = ''
            for (const line of lines) {
                if (line.startsWith('event: ')) {
                    eventType = line.slice(7)
                } else if (line.startsWith('data: ') && eventType) {
                    try {
                        const data = JSON.parse(line.slice(6))
                        handleEvent(eventType, data)
                    } catch { }
                    eventType = ''
                }
            }
        }
    } catch (err: any) {
        appendCard('error', 'Connection Error', err.message || 'Failed to connect')
    }

    loadingEl.remove()
    state.isRunning = false
    sendBtn.removeAttribute('disabled')
    inputEl.focus()
}

function handleEvent(type: string, data: any) {
    switch (type) {
        case 'session':
            state.sessionId = data.sessionId
            break
        case 'replanning':
            appendCard('thinking', 'Replanning', `Adjusting objectives for: "${data.message}"`)
            break
        case 'planning':
            state.objectives = (data.objectives || []).map((o: any) => ({ ...o, met: undefined, reason: undefined }))
            appendObjectivesPanel()
            break
        case 'iteration_start':
            appendDivider(`Iteration ${data.iteration} · ${((data.elapsed || 0) / 1000).toFixed(1)}s`)
            break
        case 'thinking':
            appendCard('thinking', 'Thinking', data.message || '')
            break
        case 'tool_start':
            appendToolCard(data.tool || '', data.params || {})
            break
        case 'tool_result':
            updateLastTool(data.result!)
            break
        case 'objective_check':
            updateObjectives(data.results || [])
            break
        case 'complete':
            appendCard('complete', 'Complete', `Done in ${(data.iteration || 0) + 1} iteration${(data.iteration || 0) > 0 ? 's' : ''} (${((data.elapsed || 0) / 1000).toFixed(1)}s)`)
            break
        case 'error':
            appendCard('error', 'Error', data.error || '')
            break
        case 'max_iterations':
            appendCard('error', 'Max Iterations', `Stopped after ${data.iteration} iterations`)
            break
    }
}

// ── JSX Components ──

function UserBubble({ text }: { text: string }) {
    return (
        <div className="msg msg-user">
            <div className="bubble">{text}</div>
        </div>
    )
}

function Loading() {
    return (
        <div className="loading">
            <div className="dots"><span /><span /><span /></div>
            <span>Agent is working...</span>
        </div>
    )
}

function Divider({ text }: { text: string }) {
    return <div className="divider">{text}</div>
}

function Card({ type, label, content }: { type: string; label: string; content: string }) {
    return (
        <div className={`card card-${type}`}>
            <div className="card-label">{label}</div>
            <div className="card-body">{content}</div>
        </div>
    )
}

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

function ObjectivesPanel({ objectives }: { objectives: typeof state.objectives }) {
    return (
        <div className="card card-planning">
            <div className="card-label">📋 Planned Objectives</div>
            <div className="obj-grid">
                {objectives.map(o => <ObjectiveItem obj={o} />)}
            </div>
        </div>
    )
}

function ToolCard({ name, params, result }: {
    name: string
    params: Record<string, any>
    result?: { success: boolean; output: string; error?: string }
}) {
    const badgeClass = !result ? 'running' : result.success ? 'success' : 'failure'
    const badgeText = !result ? 'running' : result.success ? 'success' : 'failed'
    const output = result ? (result.output || result.error || '') : ''
    return (
        <div className="card card-tool">
            <div className="tool-header">
                <span className="tool-name">{name}</span>
                <span className={`tool-badge ${badgeClass}`}>{badgeText}</span>
            </div>
            <pre className="tool-params">{JSON.stringify(params, null, 2)}</pre>
            {output && <pre className="tool-output">{output.substring(0, 500)}</pre>}
        </div>
    )
}

// ── Render helpers ──

/** Render JSX into a new container appended to the chat area, return the container */
function appendJsx(jsx: any): HTMLElement {
    const el = document.createElement('div')
    chatArea.appendChild(el)
    render(jsx, el)
    scrollDown()
    return el
}

function appendUserBubble(text: string) {
    appendJsx(<UserBubble text={text} />)
}

function appendLoading(): HTMLElement {
    return appendJsx(<Loading />)
}

function appendDivider(text: string) {
    appendJsx(<Divider text={text} />)
}

function appendCard(type: string, label: string, content: string) {
    appendJsx(<Card type={type} label={label} content={content} />)
}

let objectivesPanelEl: HTMLElement | null = null

function appendObjectivesPanel() {
    objectivesPanelEl = appendJsx(<ObjectivesPanel objectives={state.objectives} />)
}

function updateObjectives(results: Array<{ name: string; met: boolean; reason: string }>) {
    if (!objectivesPanelEl) return
    // Update state and re-render the panel
    for (const r of results) {
        const obj = state.objectives.find(o => o.name === r.name)
        if (obj) {
            obj.met = r.met
            obj.reason = r.reason
        }
    }
    render(<ObjectivesPanel objectives={state.objectives} />, objectivesPanelEl)
    scrollDown()
}

// Tool cards — track them for result updates
const toolCards: Array<{ el: HTMLElement; name: string; params: Record<string, any>; result?: any }> = []

function appendToolCard(name: string, params: Record<string, any>) {
    const entry = { el: null as any, name, params }
    entry.el = appendJsx(<ToolCard name={name} params={params} />)
    toolCards.push(entry)
}

function updateLastTool(result: { success: boolean; output: string; error?: string }) {
    const entry = toolCards[toolCards.length - 1]
    if (!entry) return
    entry.result = result
    render(<ToolCard name={entry.name} params={entry.params} result={result} />, entry.el)
    scrollDown()
}

function scrollDown() {
    requestAnimationFrame(() => {
        chatArea.scrollTop = chatArea.scrollHeight
    })
}
