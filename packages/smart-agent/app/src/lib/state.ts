// app/src/lib/state.ts — Singleton workspace state + DOM refs

import type { WorkspaceState, ToolCardEntry } from './types'

// ── State ──

export const state: WorkspaceState = {
    agents: [],
    activeAgentId: null,
    objectives: [],
    files: [],
    schedules: [],
    isRunning: false,
    activeSkills: new Set(),
    availableSkills: [],
    activeTab: 'objectives',
}

// Per-agent chat + state persistence (for instant tab switching)
export const agentChatStore = new Map<number, {
    html: string
    objectives: WorkspaceState['objectives']
    files: WorkspaceState['files']
    toolCards: ToolCardEntry[]
}>()

// Tool cards — track for result updates
export const toolCards: ToolCardEntry[] = []

// Streaming state
export let streamingEl: HTMLElement | null = null
export let streamingContent = ''
export let activeLoadingEl: HTMLElement | null = null
export let lastThinkingMessage = ''
export let lastThinkingEl: HTMLElement | null = null

export function setStreamingEl(el: HTMLElement | null) { streamingEl = el }
export function setStreamingContent(s: string) { streamingContent = s }
export function setActiveLoadingEl(el: HTMLElement | null) { activeLoadingEl = el }
export function setLastThinking(msg: string, el: HTMLElement | null) {
    lastThinkingMessage = msg
    lastThinkingEl = el
}

// ── DOM refs (set once in mount()) ──

export const dom = {
    chatArea: null as unknown as HTMLElement,
    inputEl: null as unknown as HTMLTextAreaElement,
    sendBtn: null as unknown as HTMLButtonElement,
    modelSelect: null as unknown as HTMLSelectElement,
    agentList: null as unknown as HTMLElement,
    agentHeaderName: null as unknown as HTMLElement,
    agentStatusDot: null as unknown as HTMLElement,
}

export function initDom() {
    dom.chatArea = document.getElementById('chat-area')!
    dom.inputEl = document.getElementById('input') as HTMLTextAreaElement
    dom.sendBtn = document.getElementById('send-btn') as HTMLButtonElement
    dom.modelSelect = document.getElementById('model-select') as HTMLSelectElement
    dom.agentList = document.getElementById('agent-list')!
    dom.agentHeaderName = document.getElementById('agent-header-name')!
    dom.agentStatusDot = document.getElementById('agent-status-dot')!
}

// ── Helpers ──

export function getActiveAgent() {
    return state.agents.find(a => a.id === state.activeAgentId) || null
}

export function saveState() {
    if (state.activeAgentId) {
        agentChatStore.set(state.activeAgentId, {
            html: dom.chatArea.innerHTML,
            objectives: [...state.objectives],
            files: [...state.files],
            toolCards: [...toolCards],
        })
    }
}
