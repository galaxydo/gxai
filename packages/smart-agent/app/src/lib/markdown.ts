// app/src/lib/markdown.ts — Lightweight markdown→HTML renderer

/** Escape HTML entities */
export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

/** Inline markdown formatting: bold, italic, code, links */
export function inlineFormat(text: string): string {
    return text
        .replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
}

/** Lightweight markdown → HTML for response bubbles */
export function renderMarkdown(text: string): string {
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
