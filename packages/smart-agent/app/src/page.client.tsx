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
}

const state: ChatState = {
    messages: [],
    events: [],
    objectives: [],
    isRunning: false,
    activeSkills: new Set(),
    availableSkills: [],
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

function handleEvent(type: string, data: AgentEvent) {
    switch (type) {
        case 'planning':
            state.objectives = (data.objectives || []).map(o => ({ ...o, met: undefined, reason: undefined }))
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

// ── DOM helpers ──

function esc(s: string): string {
    const d = document.createElement('div')
    d.textContent = s || ''
    return d.innerHTML
}

function appendUserBubble(text: string) {
    const el = document.createElement('div')
    el.className = 'msg msg-user'
    el.innerHTML = `<div class="bubble">${esc(text)}</div>`
    chatArea.appendChild(el)
    scrollDown()
}

function appendLoading(): HTMLElement {
    const el = document.createElement('div')
    el.className = 'loading'
    el.innerHTML = `<div class="dots"><span></span><span></span><span></span></div><span>Agent is working...</span>`
    chatArea.appendChild(el)
    scrollDown()
    return el
}

function appendDivider(text: string) {
    const el = document.createElement('div')
    el.className = 'divider'
    el.textContent = text
    chatArea.appendChild(el)
    scrollDown()
}

function appendCard(type: string, label: string, content: string) {
    const el = document.createElement('div')
    el.className = `card card-${type}`
    el.innerHTML = `<div class="card-label">${esc(label)}</div><div class="card-body">${esc(content)}</div>`
    chatArea.appendChild(el)
    scrollDown()
}

function appendObjectivesPanel() {
    const el = document.createElement('div')
    el.className = 'card card-planning'
    el.id = 'objectives-panel'
    el.innerHTML = `
        <div class="card-label">📋 Planned Objectives</div>
        <div class="obj-grid">
            ${state.objectives.map(o => `
                <div class="obj-item" data-obj="${esc(o.name)}">
                    <span class="obj-icon">⏳</span>
                    <div class="obj-info">
                        <span class="obj-name">${esc(o.name)}</span>
                        <span class="obj-desc">${esc(o.description)}</span>
                        <span class="obj-reason"></span>
                    </div>
                </div>
            `).join('')}
        </div>
    `
    chatArea.appendChild(el)
    scrollDown()
}

function updateObjectives(results: Array<{ name: string; met: boolean; reason: string }>) {
    const panel = document.getElementById('objectives-panel')
    if (!panel) return
    for (const r of results) {
        const item = panel.querySelector(`[data-obj="${r.name}"]`) as HTMLElement | null
        if (!item) continue
        item.className = `obj-item ${r.met ? 'met' : 'unmet'}`
        item.querySelector('.obj-icon')!.textContent = r.met ? '✅' : '❌'
        item.querySelector('.obj-reason')!.textContent = r.reason
    }
    scrollDown()
}

function appendToolCard(name: string, params: Record<string, any>) {
    const el = document.createElement('div')
    el.className = 'card card-tool'
    el.innerHTML = `
        <div class="tool-header">
            <span class="tool-name">${esc(name)}</span>
            <span class="tool-badge running">running</span>
        </div>
        <pre class="tool-params">${esc(JSON.stringify(params, null, 2))}</pre>
    `
    chatArea.appendChild(el)
    scrollDown()
}

function updateLastTool(result: { success: boolean; output: string; error?: string }) {
    const cards = chatArea.querySelectorAll('.card-tool')
    const card = cards[cards.length - 1] as HTMLElement | null
    if (!card) return

    const badge = card.querySelector('.tool-badge') as HTMLElement
    badge.className = `tool-badge ${result.success ? 'success' : 'failure'}`
    badge.textContent = result.success ? 'success' : 'failed'

    const output = result.output || result.error || ''
    if (output) {
        const pre = document.createElement('pre')
        pre.className = 'tool-output'
        pre.textContent = output.substring(0, 500)
        card.appendChild(pre)
    }
    scrollDown()
}

function scrollDown() {
    requestAnimationFrame(() => {
        chatArea.scrollTop = chatArea.scrollHeight
    })
}
