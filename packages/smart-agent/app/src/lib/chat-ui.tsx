// app/src/lib/chat-ui.tsx — Chat bubbles, cards, render helpers
import { render } from 'melina/client'
import { renderMarkdown } from './markdown'
import { dom, toolCards } from './state'

// ── Bubble Components ──

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

export function ToolCard({ name, params, result }: {
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

// ── Render Helpers ──

function appendJsx(jsx: any): HTMLElement {
    const el = document.createElement('div')
    dom.chatArea.appendChild(el)
    render(jsx, el)
    scrollDown()
    return el
}

export function appendUserBubble(text: string) { appendJsx(<UserBubble text={text} />) }
export function appendResponseBubble(text: string) { appendJsx(<ResponseBubble text={text} />) }
export function appendLoading(): HTMLElement { return appendJsx(<Loading />) }
export function appendDivider(text: string) { appendJsx(<Divider text={text} />) }
export function appendCard(type: string, label: string, content: string) { appendJsx(<Card type={type} label={label} content={content} />) }

export function appendThinkingCard(text: string): HTMLElement {
    const el = appendJsx(<ThinkingCard text={text} />)
    const card = el.querySelector('.card-thinking') as HTMLElement
    if (card) {
        const toggle = card.querySelector('.thinking-toggle') as HTMLElement
        if (toggle) {
            toggle.addEventListener('click', () => card.classList.toggle('collapsed'))
        }
    }
    return el
}

export function appendToolCard(name: string, params: Record<string, any>) {
    const entry = { el: null as any, name, params }
    entry.el = appendJsx(<ToolCard name={name} params={params} />)
    toolCards.push(entry)
}

export function updateLastTool(result: { success: boolean; output: string; error?: string }) {
    const entry = toolCards[toolCards.length - 1]
    if (!entry) return
    entry.result = result
    render(<ToolCard name={entry.name} params={entry.params} result={result} />, entry.el)
    scrollDown()
}

export function scrollDown() {
    requestAnimationFrame(() => {
        const { chatArea } = dom
        const isNearBottom = chatArea.scrollTop + chatArea.clientHeight >= chatArea.scrollHeight - 150
        if (isNearBottom) {
            chatArea.scrollTop = chatArea.scrollHeight
        }
    })
}
