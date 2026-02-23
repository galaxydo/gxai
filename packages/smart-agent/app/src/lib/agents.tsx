// app/src/lib/agents.tsx — Agent CRUD, chat, skills, sidebar rendering
import { render } from 'melina/client'
import { measure, measureSync } from 'measure-fn'
import {
    state, dom, agentChatStore, toolCards, getActiveAgent, saveState,
    setActiveLoadingEl,
} from './state'
import { appendUserBubble, appendLoading, appendCard, appendResponseBubble } from './chat-ui'
import { renderObjectivesPane, renderFilesPane, renderSchedulePane } from './panels'
import { handleEvent, clearLoading } from './events'
import type { AgentEntry } from './types'

// ══════════════════════════════════════
// RESTORE
// ══════════════════════════════════════

export async function restoreState() {
    try {
        const agents: any[] = await fetch('/api/agents').then(r => r.json())
        if (!agents?.length) return

        state.agents = agents.map((a: any) => ({
            id: a.id,
            name: a.name || `Agent ${a.id}`,
            sessionId: a.sessionId || null,
            status: 'idle' as const,
            model: a.model,
        }))

        if (state.agents.length > 0) {
            await selectAgent(state.agents[0].id)
        }
    } catch { /* first load, no agents yet */ }
}

// ══════════════════════════════════════
// AGENT MANAGEMENT
// ══════════════════════════════════════

export async function createAgent() {
    try {
        const num = state.agents.length + 1
        const res = await fetch('/api/agents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: `Agent ${num}` }),
        })
        const created = await res.json()
        const agent: AgentEntry = {
            id: created.id,
            name: created.name || `Agent ${num}`,
            sessionId: null,
            status: 'idle',
            model: created.model,
        }
        state.agents.push(agent)
        selectAgent(agent.id)
        renderSidebar()
    } catch (e) {
        console.error('Failed to create agent:', e)
    }
}

export async function deleteAgent(id: number) {
    if (state.isRunning && state.activeAgentId === id) return
    const idx = state.agents.findIndex(a => a.id === id)
    if (idx < 0) return
    state.agents.splice(idx, 1)
    agentChatStore.delete(id)

    fetch(`/api/agents?id=${id}`, { method: 'DELETE' }).catch(() => { })

    if (state.activeAgentId === id) {
        if (state.agents.length > 0) {
            selectAgent(state.agents[Math.max(0, idx - 1)].id)
        } else {
            state.activeAgentId = null
            dom.agentHeaderName.textContent = 'Select or create an agent'
            dom.agentStatusDot.className = 'agent-status-dot'
            dom.chatArea.innerHTML = ''
            const emptyHtml = `<div class="empty-state" id="empty-state">
                <div class="empty-icon">🤖</div>
                <h2>Smart Agent Workspace</h2>
                <p>Create a new agent or select one from the sidebar, then describe what you want it to do.</p>
                <div class="example-chips">
                    <button class="example-chip" data-prompt="tell me a short joke">🎭 tell me a joke</button>
                    <button class="example-chip" data-prompt="list all files in the current directory">📂 list files here</button>
                    <button class="example-chip" data-prompt="create a hello.txt file that says Hello World">📝 create hello.txt</button>
                    <button class="example-chip" data-prompt="what version of bun is installed?">⚡ bun version</button>
                </div>
            </div>`
            dom.chatArea.innerHTML = emptyHtml
            state.objectives = []
            state.files = []
            renderObjectivesPane()
            renderFilesPane()
        }
    }
    renderSidebar()
    saveState()
}

export async function selectAgent(id: number) {
    const prev = state.activeAgentId

    if (prev && prev !== id) {
        agentChatStore.set(prev, {
            html: dom.chatArea.innerHTML,
            objectives: [...state.objectives],
            files: [...state.files],
            toolCards: [...toolCards],
        })
    }

    state.activeAgentId = id
    const agent = state.agents.find(a => a.id === id)
    if (!agent) return

    dom.agentHeaderName.textContent = agent.name
    dom.agentStatusDot.className = `agent-status-dot ${agent.status === 'running' ? 'active' : ''}`

    const saved = agentChatStore.get(id)
    if (saved) {
        dom.chatArea.innerHTML = saved.html
        state.objectives = saved.objectives
        state.files = saved.files
        toolCards.length = 0
        toolCards.push(...saved.toolCards)
        dom.chatArea.querySelectorAll('.card-thinking .thinking-toggle').forEach(toggle => {
            const card = toggle.closest('.card-thinking') as HTMLElement
            if (card && !card.dataset.bound) {
                card.dataset.bound = '1'
                toggle.addEventListener('click', () => card.classList.toggle('collapsed'))
            }
        })
    } else {
        dom.chatArea.innerHTML = ''
        state.objectives = []
        state.files = []
        toolCards.length = 0
        try {
            const data = await fetch(`/api/state?agentId=${id}`).then(r => r.json())
            if (data.messages?.length) {
                const empty = document.getElementById('empty-state')
                if (empty) empty.remove()
                for (const msg of data.messages) {
                    if (msg.role === 'user') {
                        appendUserBubble(msg.content)
                    } else if (msg.role === 'assistant' && msg.content) {
                        appendResponseBubble(msg.content)
                    }
                }
            }
            if (data.objectives?.length) {
                state.objectives = data.objectives.map((o: any) => ({
                    name: o.name,
                    description: o.description,
                    type: o.status,
                    met: o.status === 'complete' ? true : o.status === 'failed' ? false : undefined,
                    reason: o.result,
                }))
            }
            if (data.files?.length) {
                state.files = data.files.map((f: any) => ({
                    path: f.path,
                    action: f.action === 'modified' ? 'write' as const : 'read' as const,
                }))
            }
        } catch { /* fresh agent, no state yet */ }
    }

    state.schedules = []
    renderObjectivesPane()
    renderFilesPane()
    renderSchedulePane()
    renderSidebar()
    saveState()
}

export function clearCurrentChat() {
    if (state.isRunning || !state.activeAgentId) return
    const agent = getActiveAgent()
    if (!agent) return

    dom.chatArea.innerHTML = ''
    state.objectives = []
    state.files = []
    toolCards.length = 0
    agent.sessionId = null
    agentChatStore.delete(agent.id)

    fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear', agentId: agent.id }),
    }).catch(() => { })

    renderObjectivesPane()
    renderFilesPane()
    renderSidebar()
    saveState()
    dom.inputEl.focus()
}

export function exportChatAsMarkdown() {
    if (!state.activeAgentId) return
    const agent = getActiveAgent()
    const agentName = agent?.name || 'agent'
    const lines: string[] = [`# Chat: ${agentName}`, `_Exported ${new Date().toLocaleString()}_`, '']

    for (const child of Array.from(dom.chatArea.children)) {
        const el = child as HTMLElement

        if (el.classList.contains('msg') && el.classList.contains('msg-user')) {
            const text = el.querySelector('.bubble')?.textContent?.trim() || ''
            lines.push(`## 👤 User`, '', text, '')
            continue
        }

        if (el.classList.contains('msg') && el.classList.contains('msg-agent')) {
            const text = el.querySelector('.bubble')?.textContent?.trim() || ''
            lines.push(`## 🤖 Agent`, '', text, '')
            continue
        }

        const card = el.querySelector?.('.card') as HTMLElement | null
        if (card) {
            const label = card.querySelector('.card-label')?.textContent?.trim() || ''
            const content = card.querySelector('.card-content')?.textContent?.trim() || ''
            lines.push(`> **${label}**`, `> ${content}`, '')
            continue
        }

        if (el.classList.contains('divider')) {
            lines.push(`---`, `*${el.textContent?.trim()}*`, '')
            continue
        }
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${agentName.replace(/[^a-zA-Z0-9]/g, '_')}_chat.md`
    a.click()
    URL.revokeObjectURL(url)
}

// ══════════════════════════════════════
// CHAT SEND
// ══════════════════════════════════════

export async function sendMessage() {
    const text = dom.inputEl.value.trim()
    if (!text || state.isRunning) return
    if (!state.activeAgentId) {
        await createAgent()
    }

    const agent = getActiveAgent()!
    state.isRunning = true
    agent.status = 'running'
    dom.agentStatusDot.className = 'agent-status-dot active'
    setSendButtonMode('stop')
    dom.inputEl.value = ''
    dom.inputEl.style.height = 'auto'
    renderSidebar()

    const empty = document.getElementById('empty-state')
    if (empty) empty.remove()

    if (!agent.sessionId) {
        agent.name = text.length > 24 ? text.substring(0, 24) + '…' : text
        dom.agentHeaderName.textContent = agent.name
        renderSidebar()
        fetch(`/api/agents?id=${agent.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: agent.name }),
        }).catch(() => { })
    }

    appendUserBubble(text)
    setActiveLoadingEl(appendLoading())

    await measure(`Chat: "${text.substring(0, 40)}"`, async (m) => {
        try {
            const res = await m('POST /api/chat', () => fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    model: dom.modelSelect.value,
                    skills: [...state.activeSkills],
                    sessionId: agent.sessionId,
                    agentId: agent.id,
                }),
            }))

            if (!res) throw new Error('No response')

            const reader = res.body!.getReader()
            const decoder = new TextDecoder()
            let buffer = ''
            let eventCount = 0

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
                            eventCount++
                            handleEvent(eventType, data)
                        } catch { }
                        eventType = ''
                    }
                }
            }

            measureSync(`Processed ${eventCount} SSE events`)
        } catch (err: any) {
            appendCard('error', 'Connection Error', err.message || 'Failed to connect')
        }
    })

    clearLoading()
    state.isRunning = false
    agent.status = 'idle'
    dom.agentStatusDot.className = 'agent-status-dot'
    setSendButtonMode('send')
    dom.inputEl.focus()
    renderSidebar()
    saveState()
}

// ══════════════════════════════════════
// SEND/STOP BUTTON
// ══════════════════════════════════════

export function setSendButtonMode(mode: 'send' | 'stop') {
    if (mode === 'stop') {
        dom.sendBtn.classList.add('stop-mode')
        dom.sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
        dom.sendBtn.title = 'Stop agent'
    } else {
        dom.sendBtn.classList.remove('stop-mode')
        dom.sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg>'
        dom.sendBtn.title = 'Send message'
    }
}

export async function stopAgent() {
    const agent = getActiveAgent()
    if (!agent?.sessionId || !state.isRunning) return
    try {
        await fetch(`/api/chat?sessionId=${agent.sessionId}`, { method: 'DELETE' })
    } catch { /* ignore */ }
}

// ══════════════════════════════════════
// SKILLS
// ══════════════════════════════════════

export async function loadSkills() {
    await measure('Load skills', async () => {
        const res = await fetch('/api/chat')
        state.availableSkills = await res.json()
        renderSkillChips()
    })
}

/** Populate model-select from /api/models — only active providers' models */
export async function loadModels() {
    try {
        const providers: any[] = await fetch('/api/models').then(r => r.json())
        const select = dom.modelSelect
        const currentValue = select.value

        // Clear existing options
        select.innerHTML = ''

        // Active providers first, then inactive (disabled)
        const active = providers.filter(p => p.active)
        const inactive = providers.filter(p => !p.active)

        for (const p of active) {
            const group = document.createElement('optgroup')
            group.label = p.name
            for (const m of p.models) {
                const opt = document.createElement('option')
                opt.value = m.id
                opt.textContent = m.name
                group.appendChild(opt)
            }
            select.appendChild(group)
        }

        if (inactive.length > 0) {
            const group = document.createElement('optgroup')
            group.label = '── Not configured ──'
            for (const p of inactive) {
                for (const m of p.models) {
                    const opt = document.createElement('option')
                    opt.value = m.id
                    opt.textContent = `${m.name} (needs ${p.envKey})`
                    opt.disabled = true
                    group.appendChild(opt)
                }
            }
            select.appendChild(group)
        }

        // Restore previous selection if still valid
        if (currentValue) {
            const exists = select.querySelector(`option[value="${currentValue}"]`) as HTMLOptionElement
            if (exists && !exists.disabled) select.value = currentValue
        }
    } catch (e) {
        console.error('Failed to load models:', e)
    }
}

export function renderSkillChips() {
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

// ══════════════════════════════════════
// SIDEBAR
// ══════════════════════════════════════

function SidebarAgent({ agent, isActive }: { agent: AgentEntry; isActive: boolean }) {
    return (
        <button
            className={`sidebar-agent ${isActive ? 'active' : ''}`}
            onClick={() => selectAgent(agent.id)}
        >
            <span className={`agent-dot ${agent.status === 'running' ? 'running' : 'idle'}`} />
            <span className="sidebar-agent-name">{agent.name}</span>
            <span
                className="sidebar-agent-delete"
                onClick={(e: Event) => { e.stopPropagation(); deleteAgent(agent.id) }}
                title="Delete agent"
            >✕</span>
        </button>
    )
}

export function renderSidebar() {
    render(
        <div>
            {state.agents.map(a => (
                <SidebarAgent agent={a} isActive={a.id === state.activeAgentId} />
            ))}
        </div>,
        dom.agentList
    )
}

// ══════════════════════════════════════
// RESIZE HANDLE
// ══════════════════════════════════════

export function setupResizeHandle() {
    const handle = document.getElementById('overview-resize')!
    const overview = document.getElementById('overview')!
    let startY = 0
    let startH = 0

    handle.addEventListener('mousedown', (e) => {
        startY = e.clientY
        startH = overview.offsetHeight
        document.body.style.cursor = 'row-resize'
        document.body.style.userSelect = 'none'

        const onMove = (ev: MouseEvent) => {
            const delta = startY - ev.clientY
            const newH = Math.max(120, Math.min(window.innerHeight * 0.6, startH + delta))
            overview.style.height = newH + 'px'
        }

        const onUp = () => {
            document.removeEventListener('mousemove', onMove)
            document.removeEventListener('mouseup', onUp)
            document.body.style.cursor = ''
            document.body.style.userSelect = ''
        }

        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
    })
}
