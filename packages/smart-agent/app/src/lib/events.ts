// app/src/lib/events.ts — SSE event handler for chat stream
import {
    state, dom, toolCards, getActiveAgent,
    streamingEl, streamingContent, lastThinkingMessage, lastThinkingEl,
    setStreamingEl, setStreamingContent, setLastThinking,
    activeLoadingEl, setActiveLoadingEl,
} from './state'
import {
    appendCard, appendDivider, appendToolCard, updateLastTool,
    appendResponseBubble, appendThinkingCard, scrollDown,
} from './chat-ui'
import { renderObjectivesPane, updateObjectives, renderFilesPane, switchTab, fetchSchedules } from './panels'

export function clearLoading() {
    if (activeLoadingEl) { activeLoadingEl.remove(); setActiveLoadingEl(null) }
}

export function handleEvent(type: string, data: any) {
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
            if (streamingEl) {
                streamingEl.remove()
                setStreamingEl(null)
                setStreamingContent('')
            }
            appendDivider(`Iteration ${data.iteration} · ${((data.elapsed || 0) / 1000).toFixed(1)}s`)
            break
        case 'thinking_delta': {
            clearLoading()
            setStreamingContent(streamingContent + (data.delta || ''))
            if (!streamingEl) {
                const el = document.createElement('div')
                el.className = 'msg msg-agent streaming'
                el.innerHTML = `<div class="bubble streaming-bubble"><span class="stream-text"></span><span class="stream-cursor">▌</span></div>`
                dom.chatArea.appendChild(el)
                setStreamingEl(el)
            }
            const textEl = streamingEl!.querySelector('.stream-text')
            if (textEl) textEl.textContent = streamingContent
            scrollDown()
            break
        }
        case 'thinking':
            if (streamingEl) {
                streamingEl.remove()
                setStreamingEl(null)
                setStreamingContent('')
            }
            setLastThinking(data.message || '', appendThinkingCard(data.message || ''))
            break
        case 'tool_start':
            if (streamingEl) {
                streamingEl.remove()
                setStreamingEl(null)
                setStreamingContent('')
            }
            appendToolCard(data.tool || '', data.params || {})
            if (data.tool === 'schedule') {
                fetchSchedules()
                switchTab('schedule')
            }
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
            if (streamingEl) {
                streamingEl.remove()
                setStreamingEl(null)
                setStreamingContent('')
            }
            if (lastThinkingMessage) {
                if (lastThinkingEl) lastThinkingEl.remove()
                appendResponseBubble(lastThinkingMessage)
            }
            const iters = (data.iteration || 0) + 1
            const elapsed = ((data.elapsed || 0) / 1000).toFixed(1)
            appendCard('complete', '✓ Complete', `${iters} iteration${iters > 1 ? 's' : ''} · ${elapsed}s`)
            setLastThinking('', null)
            fetchSchedules()
            break
        }
        case 'error':
            appendCard('error', 'Error', data.error || '')
            break
        case 'max_iterations': {
            if (streamingEl) {
                streamingEl.remove()
                setStreamingEl(null)
                setStreamingContent('')
            }
            if (lastThinkingMessage) {
                if (lastThinkingEl) lastThinkingEl.remove()
                appendResponseBubble(lastThinkingMessage)
            }
            appendCard('error', 'Reached Limit', `Stopped after ${data.iteration} iterations. Try rephrasing your request or breaking it into smaller steps.`)
            setLastThinking('', null)
            break
        }
        case 'cancelled': {
            if (streamingEl) {
                streamingEl.remove()
                setStreamingEl(null)
                setStreamingContent('')
            }
            if (lastThinkingMessage) {
                if (lastThinkingEl) lastThinkingEl.remove()
                appendResponseBubble(lastThinkingMessage)
            }
            const elapsed = ((data.elapsed || 0) / 1000).toFixed(1)
            appendCard('cancelled', '■ Cancelled', `Stopped after ${(data.iteration || 0) + 1} iteration${data.iteration > 0 ? 's' : ''} · ${elapsed}s`)
            setLastThinking('', null)
            break
        }
    }
}
