// app/src/page.client.tsx — Workspace mount: event wiring only
import { configure } from 'measure-fn'
import { state, dom, initDom, getActiveAgent, saveState } from './lib/state'
import { openSettings, closeSettings } from './lib/settings'
import { switchTab } from './lib/panels'
import {
    createAgent, deleteAgent, clearCurrentChat, exportChatAsMarkdown,
    sendMessage, stopAgent, loadSkills, restoreState, setupResizeHandle,
    renderSidebar,
} from './lib/agents'

configure({ timestamps: true })

export default function mount() {
    initDom()

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
    dom.inputEl.addEventListener('input', () => {
        dom.inputEl.style.height = 'auto'
        dom.inputEl.style.height = Math.min(dom.inputEl.scrollHeight, 100) + 'px'
    })

    // Enter to send
    dom.inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            sendMessage()
        }
    })

    dom.sendBtn.addEventListener('click', () => {
        if (state.isRunning) stopAgent()
        else sendMessage()
    })

    // Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
            e.preventDefault()
            createAgent()
            dom.inputEl.focus()
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
            e.preventDefault()
            clearCurrentChat()
        }
        if (e.key === 'Escape') {
            if (state.isRunning) stopAgent()
            else closeSettings()
        }
    })

    // Example chip delegation
    document.addEventListener('click', (e) => {
        const chip = (e.target as HTMLElement).closest('[data-prompt]') as HTMLElement | null
        if (chip) {
            if (!state.activeAgentId) createAgent()
            dom.inputEl.value = chip.dataset.prompt || ''
            dom.inputEl.dispatchEvent(new Event('input'))
            sendMessage()
        }
    })

    // Overview resize
    setupResizeHandle()

    // Code block copy button delegation
    dom.chatArea.addEventListener('click', (e) => {
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
    dom.agentHeaderName.addEventListener('dblclick', () => {
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
            dom.agentHeaderName.textContent = newName
            renderSidebar()
            saveState()
        }

        input.addEventListener('blur', commitRename)
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); input.blur() }
            if (e.key === 'Escape') { input.value = currentName; input.blur() }
        })

        dom.agentHeaderName.textContent = ''
        dom.agentHeaderName.appendChild(input)
        input.focus()
        input.select()
    })

    // File drag-and-drop on chat area
    dom.chatArea.addEventListener('dragover', (e) => {
        e.preventDefault()
        dom.chatArea.classList.add('drag-over')
    })
    dom.chatArea.addEventListener('dragleave', () => {
        dom.chatArea.classList.remove('drag-over')
    })
    dom.chatArea.addEventListener('drop', async (e) => {
        e.preventDefault()
        dom.chatArea.classList.remove('drag-over')
        const files = e.dataTransfer?.files
        if (!files?.length) return

        if (!state.activeAgentId) createAgent()

        for (const file of Array.from(files)) {
            const text = await file.text()
            const truncated = text.length > 10000 ? text.substring(0, 10000) + '\n...(truncated)' : text
            const contextMsg = `[Attached file: ${file.name} (${(file.size / 1024).toFixed(1)}KB)]\n\n\`\`\`\n${truncated}\n\`\`\``
            dom.inputEl.value = (dom.inputEl.value ? dom.inputEl.value + '\n\n' : '') + contextMsg
            dom.inputEl.style.height = 'auto'
            dom.inputEl.style.height = Math.min(dom.inputEl.scrollHeight, 100) + 'px'
        }
        dom.inputEl.focus()
    })

    // Restore persisted state from server
    restoreState()

    return () => { }
}
