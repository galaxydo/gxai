// smart-agent/src/xml.ts
// Lightweight XML encode/decode for structured LLM prompts

/** Converts an object to an XML string */
export function objToXml(obj: any, parentKey?: string): string {
    const safe = (name: string) => name.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^[^a-zA-Z]/, "tag_$&")
    const wrap = (tag: string, content: string) => `<${safe(tag)}>${content}</${safe(tag)}>`

    if (Array.isArray(obj)) {
        return wrap(
            parentKey || "array",
            obj.map(item => wrap("item", typeof item === "object" ? objToXml(item) : String(item))).join("")
        )
    }

    if (obj && typeof obj === "object") {
        const entries = Object.entries(obj).filter(([, v]) => v !== undefined && v !== null)
        if (entries.length === 0) return wrap(parentKey || "empty", "")
        const content = entries
            .map(([key, value]) =>
                typeof value === "object" ? objToXml(value, key) : `<${key}>${String(value)}</${key}>`
            )
            .join("")
        return parentKey ? wrap(parentKey, content) : content
    }

    return wrap(parentKey || "value", String(obj))
}

/** Parses an XML string into an object */
export function xmlToObj(xmlContent: string): any {
    const parseElement = (content: string): any => {
        content = content.trim()
        if (!content.includes("<")) return content || ""

        const result: any = {}
        const tagRegex = /<([^>\s/]+)(?:[^>]*)>(.*?)<\/\1>/gs
        let match
        let hasMatches = false

        while ((match = tagRegex.exec(content)) !== null) {
            hasMatches = true
            const [, tagName, tagContent] = match
            let child: any

            if (tagContent!.trim().includes("<")) {
                child = parseElement(tagContent!)
            } else {
                const trimmed = tagContent!.trim()
                if (trimmed === "true" || trimmed === "false") {
                    child = trimmed === "true"
                } else if (/^\d+(\.\d+)?$/.test(trimmed)) {
                    child = Number(trimmed)
                } else {
                    child = trimmed
                }
            }

            if (result[tagName!] === undefined) {
                result[tagName!] = child
            } else if (Array.isArray(result[tagName!])) {
                result[tagName!].push(child)
            } else {
                result[tagName!] = [result[tagName!], child]
            }
        }

        if (!hasMatches) return content

        // Unwrap 'item' arrays
        const keys = Object.keys(result)
        if (keys.length === 1 && keys[0] === "item") {
            const val = result.item
            return Array.isArray(val) ? val : [val]
        }

        return result
    }

    return parseElement(xmlContent)
}
