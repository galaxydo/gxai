// app/src/page.client.tsx — Workspace client: agent management, chat, tabbed overview
import { render } from 'melina/client';
import { measure, measureSync, configure } from 'measure-fn';

configure({ timestamps: true });

// ── Types ──

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

interface AgentEntry {
    id: number
    name: string
    sessionId: string | null
    status: 'idle' | 'running'
    model?: string
}

interface WorkspaceState {
    agents: AgentEntry[]
    activeAgentId: number | null
    objectives: Array<{ name: string; description: string; type: string; met?: boolean; reason?: string }>
    files: Array<{ path: string; action: 'read' | 'write' }>
    schedules: Array<{
        id: string
        name: string
        scriptPath: string
        intervalSec: number
        nextRun: number
        lastRun?: number
        lastResult?: { success: boolean; output: string; error?: string }
    }>
    isRunning: boolean
    activeSkills: Set<string>
    availableSkills: string[]
    activeTab: 'objectives' | 'files' | 'schedule'
}

const state: WorkspaceState = {
    agents: [],
    activeAgentId: null as number | null,
    objectives: [],
    files: [],
    schedules: [],
    isRunning: false,
    activeSkills: new Set(),
    availableSkills: [],
    activeTab: 'objectives',
}

// Per-agent chat + state persistence
const agentChatStore = new Map<number, {
    html: string
    objectives: WorkspaceState['objectives']
    files: WorkspaceState['files']
    toolCards: typeof toolCardsRef
}>()
type ToolCardEntry = { el: HTMLElement; name: string; params: Record<string, any>; result?: any }
const toolCardsRef: ToolCardEntry[] = []

// ── DOM refs ──
let chatArea: HTMLElement
let inputEl: HTMLTextAreaElement
let sendBtn: HTMLButtonElement
let modelSelect: HTMLSelectElement
let agentList: HTMLElement
let agentHeaderName: HTMLElement
let agentStatusDot: HTMLElement

export default function mount() {
    chatArea = document.getElementById('chat-area')!
    inputEl = document.getElementById('input') as HTMLTextAreaElement
    sendBtn = document.getElementById('send-btn') as HTMLButtonElement
    modelSelect = document.getElementById('model-select') as HTMLSelectElement
    agentList = document.getElementById('agent-list')!
    agentHeaderName = document.getElementById('agent-header-name')!
    agentStatusDot = document.getElementById('agent-status-dot')!

    // Load skills
    loadSkills()

    // Tab switching
    document.getElementById('tab-bar')!.addEventListener('click', (e) => {
        const tab = (e.target as HTMLElement).closest('.tab') as HTMLElement | null
        if (!tab) return
        const tabName = tab.dataset.tab as any
        if (tabName) switchTab(tabName)
    })

    // New agent button
    document.getElementById('new-agent-btn')!.addEventListener('click', createAgent)

    // Settings button (sidebar only — nav rail settings is handled by layout.client.tsx)
    document.getElementById('settings-btn')!.addEventListener('click', openSettings)
    // Listen for settings event from nav rail (via layout.client.tsx)
    window.addEventListener('smart-agent:open-settings', openSettings)

    // Header action buttons
    document.getElementById('export-chat-btn')!.addEventListener('click', exportChatAsMarkdown)
    document.getElementById('clear-chat-btn')!.addEventListener('click', clearCurrentChat)

    // Auto-resize textarea
    inputEl.addEventListener('input', () => {
        inputEl.style.height = 'auto'
        inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + 'px'
    })

    // Enter to send
    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            sendMessage()
        }
    })

    sendBtn.addEventListener('click', () => {
        if (state.isRunning) stopAgent()
        else sendMessage()
    })

    // Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl+N — new agent
        if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
            e.preventDefault()
            createAgent()
            inputEl.focus()
        }
        // Ctrl+L — clear current agent chat
        if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
            e.preventDefault()
            clearCurrentChat()
        }
        // Escape — close settings or stop agent
        if (e.key === 'Escape') {
            if (state.isRunning) stopAgent()
            else closeSettings()
        }
    })

    // Example chip delegation
    document.addEventListener('click', (e) => {
        const chip = (e.target as HTMLElement).closest('[data-prompt]') as HTMLElement | null
        if (chip) {
            // Auto-create agent if none selected
            if (!state.activeAgentId) createAgent()
            inputEl.value = chip.dataset.prompt || ''
            inputEl.dispatchEvent(new Event('input'))
            sendMessage()
        }
    })

    // Overview resize
    setupResizeHandle()

    // Code block copy button delegation
    chatArea.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('.md-copy-btn') as HTMLElement | null
        if (!btn) return
        const code = btn.dataset.code || ''
        const decoded = code.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
        navigator.clipboard.writeText(decoded)
        btn.textContent = '✓ Copied'
        btn.classList.add('copied')
        setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied') }, 1500)
    })

    // Double-click agent header name to rename
    agentHeaderName.addEventListener('dblclick', () => {
        const agent = getActiveAgent()
        if (!agent) return

        const currentName = agent.name
        const input = document.createElement('input')
        input.type = 'text'
        input.value = currentName
        input.className = 'agent-rename-input'

        const commitRename = () => {
            const newName = input.value.trim() || currentName
            agent.name = newName
            agentHeaderName.textContent = newName
            renderSidebar()
            saveState()
        }

        input.addEventListener('blur', commitRename)
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); input.blur() }
            if (e.key === 'Escape') { input.value = currentName; input.blur() }
        })

        agentHeaderName.textContent = ''
        agentHeaderName.appendChild(input)
        input.focus()
        input.select()
    })

    // File drag-and-drop on chat area
    chatArea.addEventListener('dragover', (e) => {
        e.preventDefault()
        chatArea.classList.add('drag-over')
    })
    chatArea.addEventListener('dragleave', () => {
        chatArea.classList.remove('drag-over')
    })
    chatArea.addEventListener('drop', async (e) => {
        e.preventDefault()
        chatArea.classList.remove('drag-over')
        const files = e.dataTransfer?.files
        if (!files?.length) return

        // Auto-create agent if none
        if (!state.activeAgentId) createAgent()

        for (const file of Array.from(files)) {
            const text = await file.text()
            const truncated = text.length > 10000 ? text.substring(0, 10000) + '\n...(truncated)' : text
            const contextMsg = `[Attached file: ${file.name} (${(file.size / 1024).toFixed(1)}KB)]\n\n\`\`\`\n${truncated}\n\`\`\``
            inputEl.value = (inputEl.value ? inputEl.value + '\n\n' : '') + contextMsg
            inputEl.style.height = 'auto'
            inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + 'px'
        }
        inputEl.focus()
    })

    // Restore persisted state from server
    restoreState()

    return () => { }
}

// ══════════════════════════════════════
// PERSISTENCE (SQLite API)
// ══════════════════════════════════════

/** Save current agent's in-memory chat HTML to store (for fast tab switching) */
function saveState() {
    if (state.activeAgentId) {
        agentChatStore.set(state.activeAgentId, {
            html: chatArea.innerHTML,
            objectives: [...state.objectives],
            files: [...state.files],
            toolCards: [...toolCards],
        })
    }
}

/** Restore agents from the server DB */
async function restoreState() {
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

        // Select first agent and load its history
        if (state.agents.length > 0) {
            await selectAgent(state.agents[0].id)
        }
    } catch { /* first load, no agents yet */ }
}

// ══════════════════════════════════════
// AGENT MANAGEMENT
// ══════════════════════════════════════

async function createAgent() {
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

async function deleteAgent(id: number) {
    if (state.isRunning && state.activeAgentId === id) return
    const idx = state.agents.findIndex(a => a.id === id)
    if (idx < 0) return
    state.agents.splice(idx, 1)
    agentChatStore.delete(id)

    // Delete on server
    fetch(`/api/agents?id=${id}`, { method: 'DELETE' }).catch(() => { })

    if (state.activeAgentId === id) {
        if (state.agents.length > 0) {
            selectAgent(state.agents[Math.max(0, idx - 1)].id)
        } else {
            state.activeAgentId = null
            agentHeaderName.textContent = 'Select or create an agent'
            agentStatusDot.className = 'agent-status-dot'
            chatArea.innerHTML = ''
            // Re-show empty state
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
            chatArea.innerHTML = emptyHtml
            state.objectives = []
            state.files = []
            renderObjectivesPane()
            renderFilesPane()
        }
    }
    renderSidebar()
    saveState()
}

async function selectAgent(id: number) {
    const prev = state.activeAgentId

    // Save current agent's chat state before switching
    if (prev && prev !== id) {
        agentChatStore.set(prev, {
            html: chatArea.innerHTML,
            objectives: [...state.objectives],
            files: [...state.files],
            toolCards: [...toolCards],
        })
    }

    state.activeAgentId = id
    const agent = state.agents.find(a => a.id === id)
    if (!agent) return

    // Update header
    agentHeaderName.textContent = agent.name
    agentStatusDot.className = `agent-status-dot ${agent.status === 'running' ? 'active' : ''}`

    // Restore saved chat for this agent
    const saved = agentChatStore.get(id)
    if (saved) {
        chatArea.innerHTML = saved.html
        state.objectives = saved.objectives
        state.files = saved.files
        toolCards.length = 0
        toolCards.push(...saved.toolCards)
        // Re-attach thinking card toggle listeners
        chatArea.querySelectorAll('.card-thinking .thinking-toggle').forEach(toggle => {
            const card = toggle.closest('.card-thinking') as HTMLElement
            if (card && !card.dataset.bound) {
                card.dataset.bound = '1'
                toggle.addEventListener('click', () => card.classList.toggle('collapsed'))
            }
        })
    } else {
        // No in-memory cache — try loading from DB
        chatArea.innerHTML = ''
        state.objectives = []
        state.files = []
        toolCards.length = 0
        try {
            const data = await fetch(`/api/state?agentId=${id}`).then(r => r.json())
            if (data.messages?.length) {
                // Remove empty state if present
                const empty = document.getElementById('empty-state')
                if (empty) empty.remove()
                // Reconstruct chat from stored messages
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

function clearCurrentChat() {
    if (state.isRunning || !state.activeAgentId) return
    const agent = getActiveAgent()
    if (!agent) return

    // Reset chat and session
    chatArea.innerHTML = ''
    state.objectives = []
    state.files = []
    toolCards.length = 0
    agent.sessionId = null
    agentChatStore.delete(agent.id)

    // Clear server-side state
    fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear', agentId: agent.id }),
    }).catch(() => { })

    renderObjectivesPane()
    renderFilesPane()
    renderSidebar()
    saveState()
    inputEl.focus()
}

function exportChatAsMarkdown() {
    if (!state.activeAgentId) return
    const agent = getActiveAgent()
    const agentName = agent?.name || 'agent'
    const lines: string[] = [`# Chat: ${agentName}`, `_Exported ${new Date().toLocaleString()}_`, '']

    // Walk through chat DOM children
    for (const child of Array.from(chatArea.children)) {
        const el = child as HTMLElement

        // User message
        if (el.classList.contains('msg') && el.classList.contains('msg-user')) {
            const text = el.querySelector('.bubble')?.textContent?.trim() || ''
            lines.push(`## 👤 User`, '', text, '')
            continue
        }

        // Agent response
        if (el.classList.contains('msg') && el.classList.contains('msg-agent')) {
            const text = el.querySelector('.bubble')?.textContent?.trim() || ''
            lines.push(`## 🤖 Agent`, '', text, '')
            continue
        }

        // Cards (complete, error, planning, etc.)
        const card = el.querySelector?.('.card') as HTMLElement | null
        if (card) {
            const label = card.querySelector('.card-label')?.textContent?.trim() || ''
            const content = card.querySelector('.card-content')?.textContent?.trim() || ''
            lines.push(`> **${label}**`, `> ${content}`, '')
            continue
        }

        // Dividers
        if (el.classList.contains('divider')) {
            lines.push(`---`, `*${el.textContent?.trim()}*`, '')
            continue
        }
    }

    // Download as .md file
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${agentName.replace(/[^a-zA-Z0-9]/g, '_')}_chat.md`
    a.click()
    URL.revokeObjectURL(url)
}

function getActiveAgent(): AgentEntry | null {
    return state.agents.find(a => a.id === state.activeAgentId) || null
}

// ── Sidebar JSX ──

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

function renderSidebar() {
    render(
        <div>
            {state.agents.map(a => (
                <SidebarAgent agent={a} isActive={a.id === state.activeAgentId} />
            ))}
        </div>,
        agentList
    )
}

// ══════════════════════════════════════
// SKILLS
// ══════════════════════════════════════

async function loadSkills() {
    await measure('Load skills', async () => {
        const res = await fetch('/api/chat')
        state.availableSkills = await res.json()
        renderSkillChips()
    })
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

// ══════════════════════════════════════
// TAB SWITCHING
// ══════════════════════════════════════

function switchTab(tab: 'objectives' | 'files' | 'schedule') {
    state.activeTab = tab

    // Update tab buttons
    document.querySelectorAll('#tab-bar .tab').forEach(t => {
        t.classList.toggle('active', (t as HTMLElement).dataset.tab === tab)
    })

    // Update panes
    document.querySelectorAll('.tab-pane').forEach(p => {
        p.classList.toggle('active', p.id === `pane-${tab}`)
    })

    // Schedule polling
    if (tab === 'schedule') {
        startSchedulePolling()
    } else {
        stopSchedulePolling()
    }
}

// ══════════════════════════════════════
// CHAT
// ══════════════════════════════════════

async function sendMessage() {
    const text = inputEl.value.trim()
    if (!text || state.isRunning) return
    if (!state.activeAgentId) {
        await createAgent()
    }

    const agent = getActiveAgent()!
    state.isRunning = true
    agent.status = 'running'
    agentStatusDot.className = 'agent-status-dot active'
    setSendButtonMode('stop')
    inputEl.value = ''
    inputEl.style.height = 'auto'
    renderSidebar()

    // Remove empty state
    const empty = document.getElementById('empty-state')
    if (empty) empty.remove()

    // Rename agent if first message
    if (!agent.sessionId) {
        agent.name = text.length > 24 ? text.substring(0, 24) + '…' : text
        agentHeaderName.textContent = agent.name
        renderSidebar()
        // Update name on server
        fetch(`/api/agents?id=${agent.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: agent.name }),
        }).catch(() => { })
    }

    appendUserBubble(text)
    activeLoadingEl = appendLoading()

    await measure(`Chat: "${text.substring(0, 40)}"`, async (m) => {
        try {
            const res = await m('POST /api/chat', () => fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    model: modelSelect.value,
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
    agentStatusDot.className = 'agent-status-dot'
    setSendButtonMode('send')
    inputEl.focus()
    renderSidebar()
    saveState()
}

// ── Send/Stop Button ──

function setSendButtonMode(mode: 'send' | 'stop') {
    if (mode === 'stop') {
        sendBtn.classList.add('stop-mode')
        sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
        sendBtn.title = 'Stop agent'
    } else {
        sendBtn.classList.remove('stop-mode')
        sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg>'
        sendBtn.title = 'Send message'
    }
}

async function stopAgent() {
    const agent = getActiveAgent()
    if (!agent?.sessionId || !state.isRunning) return
    try {
        await fetch(`/api/chat?sessionId=${agent.sessionId}`, { method: 'DELETE' })
    } catch { /* ignore */ }
}

// ══════════════════════════════════════
// EVENT HANDLING
// ══════════════════════════════════════

// Streaming state
let streamingEl: HTMLElement | null = null
let streamingContent = ''
let activeLoadingEl: HTMLElement | null = null

function clearLoading() {
    if (activeLoadingEl) { activeLoadingEl.remove(); activeLoadingEl = null }
}

function handleEvent(type: string, data: any) {
    const agent = getActiveAgent()

    switch (type) {
        case 'session':
            if (agent) agent.sessionId = data.sessionId
            break
        case 'replanning':
            clearLoading()
            appendCard('thinking', 'Replanning', `Adjusting objectives for: "${data.message}"`)
            break
        case 'planning':
            state.objectives = (data.objectives || []).map((o: any) => ({ ...o, met: undefined, reason: undefined }))
            renderObjectivesPane()
            switchTab('objectives')
            appendCard('planning', 'Planned Objectives', state.objectives.map((o: any) => `• ${o.name} — ${o.description}`).join('\n'))
            break
        case 'iteration_start':
            // Clear any previous stream for new iteration
            if (streamingEl) {
                streamingEl.remove()
                streamingEl = null
                streamingContent = ''
            }
            appendDivider(`Iteration ${data.iteration} · ${((data.elapsed || 0) / 1000).toFixed(1)}s`)
            break
        case 'thinking_delta': {
            // Progressive streaming — append token to streaming bubble
            clearLoading()
            streamingContent += data.delta || ''
            if (!streamingEl) {
                streamingEl = document.createElement('div')
                streamingEl.className = 'msg msg-agent streaming'
                streamingEl.innerHTML = `<div class="bubble streaming-bubble"><span class="stream-text"></span><span class="stream-cursor">▌</span></div>`
                chatArea.appendChild(streamingEl)
            }
            const textEl = streamingEl.querySelector('.stream-text')
            if (textEl) textEl.textContent = streamingContent
            scrollDown()
            break
        }
        case 'thinking':
            // Finalize stream: remove streaming bubble, show thinking card
            if (streamingEl) {
                streamingEl.remove()
                streamingEl = null
                streamingContent = ''
            }
            lastThinkingMessage = data.message || ''
            lastThinkingEl = appendThinkingCard(data.message || '')
            break
        case 'tool_start':
            // Clear stream when tools start
            if (streamingEl) {
                streamingEl.remove()
                streamingEl = null
                streamingContent = ''
            }
            appendToolCard(data.tool || '', data.params || {})
            // Auto-switch to schedule tab when schedule tool is used
            if (data.tool === 'schedule') {
                fetchSchedules()
                switchTab('schedule')
            }
            // Track files
            if (data.params?.path) {
                const action = ['write_file', 'edit_file'].includes(data.tool) ? 'write' as const : 'read' as const
                const existing = state.files.find(f => f.path === data.params.path)
                if (!existing) {
                    state.files.push({ path: data.params.path, action })
                } else if (action === 'write') {
                    existing.action = 'write'
                }
                renderFilesPane()
            }
            break
        case 'tool_result':
            updateLastTool(data.result!)
            break
        case 'objective_check':
            updateObjectives(data.results || [])
            break
        case 'complete': {
            // Clear streaming
            if (streamingEl) {
                streamingEl.remove()
                streamingEl = null
                streamingContent = ''
            }
            // Show the last thinking message as a clean response bubble
            if (lastThinkingMessage) {
                if (lastThinkingEl) lastThinkingEl.remove()
                appendResponseBubble(lastThinkingMessage)
            }
            const iters = (data.iteration || 0) + 1
            const elapsed = ((data.elapsed || 0) / 1000).toFixed(1)
            appendCard('complete', '✓ Complete', `${iters} iteration${iters > 1 ? 's' : ''} · ${elapsed}s`)
            lastThinkingMessage = ''
            lastThinkingEl = null
            // Refresh schedule data in case agent scheduled tasks
            fetchSchedules()
            break
        }
        case 'error':
            appendCard('error', 'Error', data.error || '')
            break
        case 'max_iterations': {
            if (streamingEl) {
                streamingEl.remove()
                streamingEl = null
                streamingContent = ''
            }
            if (lastThinkingMessage) {
                if (lastThinkingEl) lastThinkingEl.remove()
                appendResponseBubble(lastThinkingMessage)
            }
            appendCard('error', 'Reached Limit', `Stopped after ${data.iteration} iterations. Try rephrasing your request or breaking it into smaller steps.`)
            lastThinkingMessage = ''
            lastThinkingEl = null
            break
        }
        case 'cancelled': {
            if (streamingEl) {
                streamingEl.remove()
                streamingEl = null
                streamingContent = ''
            }
            if (lastThinkingMessage) {
                if (lastThinkingEl) lastThinkingEl.remove()
                appendResponseBubble(lastThinkingMessage)
            }
            const elapsed = ((data.elapsed || 0) / 1000).toFixed(1)
            appendCard('cancelled', '■ Cancelled', `Stopped after ${(data.iteration || 0) + 1} iteration${data.iteration > 0 ? 's' : ''} · ${elapsed}s`)
            lastThinkingMessage = ''
            lastThinkingEl = null
            break
        }
    }
}

// ══════════════════════════════════════
// OVERVIEW PANELS
// ══════════════════════════════════════

// ── Objectives ──

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

function renderObjectivesPane() {
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

function updateObjectives(results: Array<{ name: string; met: boolean; reason: string }>) {
    for (const r of results) {
        const obj = state.objectives.find(o => o.name === r.name)
        if (obj) {
            obj.met = r.met
            obj.reason = r.reason
        }
    }
    renderObjectivesPane()
}

// ── Files ──

function renderFilesPane() {
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

// ── Schedule ──

let schedulePoller: ReturnType<typeof setInterval> | null = null

async function fetchSchedules() {
    try {
        const res = await fetch('/api/schedule')
        if (res.ok) {
            state.schedules = await res.json()
            renderSchedulePane()
        }
    } catch { /* ignore */ }
}

function startSchedulePolling() {
    if (schedulePoller) return
    fetchSchedules()
    schedulePoller = setInterval(fetchSchedules, 5000)
}

function stopSchedulePolling() {
    if (schedulePoller) { clearInterval(schedulePoller); schedulePoller = null }
}

function formatTimeUntil(ts: number): string {
    const diff = Math.max(0, ts - Date.now())
    const sec = Math.floor(diff / 1000)
    if (sec < 60) return `${sec}s`
    const min = Math.floor(sec / 60)
    return `${min}m ${sec % 60}s`
}

function renderSchedulePane() {
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

// ══════════════════════════════════════
// CHAT RENDERING
// ══════════════════════════════════════

function UserBubble({ text }: { text: string }) {
    return (
        <div className="msg msg-user">
            <div className="bubble">{text}</div>
        </div>
    )
}

function ResponseBubble({ text }: { text: string }) {
    return (
        <div className="msg msg-agent">
            <div className="bubble" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
        </div>
    )
}

/** Lightweight markdown → HTML for response bubbles */
function renderMarkdown(text: string): string {
    // First extract code blocks to protect their content
    const codeBlocks: string[] = []
    text = text.replace(/```(\w+)?\n([\s\S]*?)```/g, (_: string, lang: string, code: string) => {
        const idx = codeBlocks.length
        const langLabel = lang || 'text'
        codeBlocks.push(
            `<div class="md-code-wrapper">` +
            `<div class="md-code-header"><span class="md-code-lang">${langLabel}</span><button class="md-copy-btn" data-code="${escapeHtml(code.trim()).replace(/"/g, '&quot;')}">Copy</button></div>` +
            `<pre class="md-code-block"><code class="lang-${langLabel}">${escapeHtml(code.trim())}</code></pre>` +
            `</div>`
        )
        return `\x00CODE${idx}\x00`
    })

    // Process line-by-line for block-level elements
    const lines = text.split('\n')
    const out: string[] = []
    let i = 0

    while (i < lines.length) {
        const line = lines[i]

        // Code block placeholder
        const codeMatch = line.match(/^\x00CODE(\d+)\x00$/)
        if (codeMatch) {
            out.push(codeBlocks[parseInt(codeMatch[1])])
            i++
            continue
        }

        // Headers
        const hMatch = line.match(/^(#{1,4})\s+(.+)/)
        if (hMatch) {
            const level = hMatch[1].length
            out.push(`<h${level} class="md-heading">${inlineFormat(hMatch[2])}</h${level}>`)
            i++
            continue
        }

        // Horizontal rule
        if (/^---+$/.test(line.trim())) {
            out.push('<hr class="md-hr">')
            i++
            continue
        }

        // Bullet lists (- or *)
        if (/^\s*[-*]\s+/.test(line)) {
            const items: string[] = []
            while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
                items.push(lines[i].replace(/^\s*[-*]\s+/, ''))
                i++
            }
            out.push('<ul class="md-list">' + items.map(it => `<li>${inlineFormat(it)}</li>`).join('') + '</ul>')
            continue
        }

        // Numbered lists
        if (/^\s*\d+[.)]\s+/.test(line)) {
            const items: string[] = []
            while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
                items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''))
                i++
            }
            out.push('<ol class="md-list">' + items.map(it => `<li>${inlineFormat(it)}</li>`).join('') + '</ol>')
            continue
        }

        // Normal line with inline formatting
        if (line.trim()) {
            out.push(inlineFormat(line))
        } else {
            out.push('<br>')
        }
        i++
    }

    return out.join('\n')
}

/** Inline markdown formatting: bold, italic, code, links */
function inlineFormat(text: string): string {
    return text
        .replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

function ThinkingCard({ text }: { text: string }) {
    const preview = text.length > 80 ? text.substring(0, 80) + '…' : text
    return (
        <div className="card card-thinking collapsed">
            <div className="card-label thinking-toggle">
                <span className="thinking-arrow">▶</span> Thinking
            </div>
            <div className="card-preview">{preview}</div>
            <div className="card-body">{text}</div>
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

function appendJsx(jsx: any): HTMLElement {
    const el = document.createElement('div')
    chatArea.appendChild(el)
    render(jsx, el)
    scrollDown()
    return el
}

function appendUserBubble(text: string) { appendJsx(<UserBubble text={text} />) }
function appendResponseBubble(text: string) { appendJsx(<ResponseBubble text={text} />) }
function appendLoading(): HTMLElement { return appendJsx(<Loading />) }
function appendDivider(text: string) { appendJsx(<Divider text={text} />) }
function appendCard(type: string, label: string, content: string) { appendJsx(<Card type={type} label={label} content={content} />) }

function appendThinkingCard(text: string): HTMLElement {
    const el = appendJsx(<ThinkingCard text={text} />)
    // Add click-to-expand behavior
    const card = el.querySelector('.card-thinking') as HTMLElement
    if (card) {
        const toggle = card.querySelector('.thinking-toggle') as HTMLElement
        if (toggle) {
            toggle.addEventListener('click', () => {
                card.classList.toggle('collapsed')
            })
        }
    }
    return el
}

// Tool cards — track for result updates
const toolCards: ToolCardEntry[] = []
let lastThinkingMessage = ''
let lastThinkingEl: HTMLElement | null = null

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
        // Only auto-scroll if user is near the bottom (not manually scrolled up)
        const isNearBottom = chatArea.scrollTop + chatArea.clientHeight >= chatArea.scrollHeight - 150
        if (isNearBottom) {
            chatArea.scrollTop = chatArea.scrollHeight
        }
    })
}

// ══════════════════════════════════════
// RESIZE HANDLE
// ══════════════════════════════════════

function setupResizeHandle() {
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

// ══════════════════════════════════════
// SETTINGS MODAL
// ══════════════════════════════════════

function SettingsModal() {
    const cwd = location.origin
    const model = modelSelect.value
    const agentCount = state.agents.length

    return (
        <div className="settings-overlay" onClick={(e: Event) => {
            if ((e.target as HTMLElement).classList.contains('settings-overlay')) closeSettings()
        }}>
            <div className="settings-panel">
                <div className="settings-header">
                    <span className="settings-title">⚙ Settings</span>
                    <button className="settings-close" onClick={closeSettings}>✕</button>
                </div>
                <div className="settings-body">
                    <div className="settings-group">
                        <span className="settings-label">Working Directory</span>
                        <div className="settings-value">{cwd}</div>
                    </div>

                    <div className="settings-group">
                        <span className="settings-label">Active Model</span>
                        <div className="settings-value">{model}</div>
                    </div>

                    <div className="settings-group">
                        <span className="settings-label">Agents</span>
                        <div className="settings-value">{agentCount} active</div>
                    </div>

                    <div className="settings-group">
                        <span className="settings-label">Keyboard Shortcuts</span>
                        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 4px;">
                            <div className="settings-kbd"><span className="kbd">Ctrl+N</span> New agent</div>
                            <div className="settings-kbd"><span className="kbd">Ctrl+L</span> Clear chat</div>
                            <div className="settings-kbd"><span className="kbd">Enter</span> Send message</div>
                            <div className="settings-kbd"><span className="kbd">Shift+Enter</span> New line</div>
                            <div className="settings-kbd"><span className="kbd">Esc</span> Stop agent / Close modal</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

function openSettings() {
    const container = document.getElementById('settings-modal')!
    render(<SettingsModal />, container)
}

function closeSettings() {
    const container = document.getElementById('settings-modal')!
    container.innerHTML = ''
}
