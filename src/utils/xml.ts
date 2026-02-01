/**
 * XML utilities for structured data exchange
 */

/**
 * Converts an object to an XML string
 */
export function objToXml(obj: any, parentKey?: string): string {
    const sanitizeTagName = (name: string): string => {
        return name.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^[^a-zA-Z]/, "tag_$&");
    };

    const wrapTag = (tag: string, content: string): string => {
        const safeTag = sanitizeTagName(tag);
        return `<${safeTag}>${content}</${safeTag}>`;
    };

    if (Array.isArray(obj)) {
        return wrapTag(
            `${parentKey ?? "array"}`,
            obj.map((item) => wrapTag("item", typeof item === "object" ? objToXml(item) : String(item))).join("")
        );
    }

    if (obj && typeof obj === "object") {
        const entries = Object.entries(obj).filter(([, v]) => v !== undefined && v !== null);
        if (entries.length === 0) {
            return wrapTag(parentKey || "empty", "");
        }
        const content = entries
            .map(([key, value]) =>
                typeof value === "object" ? objToXml(value, key) : `<${key}>${String(value)}</${key}>`
            )
            .join("");
        return parentKey ? wrapTag(parentKey, content) : content;
    }

    return parentKey ? wrapTag(parentKey, String(obj ?? "")) : String(obj ?? "");
}

/**
 * Parses an XML string into an object
 */
export function xmlToObj(xmlContent: string): any {
    const parseElement = (content: string): any => {
        const tagRegex = /<(\w+)>([\s\S]*?)<\/\1>/g;
        const result: Record<string, any> = {};
        let match;
        let foundTags = false;

        while ((match = tagRegex.exec(content)) !== null) {
            foundTags = true;
            const [, tagName, tagContent] = match;
            if (!tagName || !tagContent) continue;

            if (/<\w+>/.test(tagContent)) {
                if (tagName === "array" || /<item>/.test(tagContent)) {
                    const items: any[] = [];
                    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
                    let itemMatch;
                    while ((itemMatch = itemRegex.exec(tagContent)) !== null) {
                        const itemContent = itemMatch[1];
                        if (itemContent === undefined) continue;
                        if (/<\w+>/.test(itemContent)) {
                            items.push(parseElement(itemContent));
                        } else {
                            items.push(itemContent.trim());
                        }
                    }
                    result[tagName] = items;
                } else {
                    result[tagName] = parseElement(tagContent);
                }
            } else {
                result[tagName] = tagContent.trim();
            }
        }
        return foundTags ? result : content.trim();
    };

    return parseElement(xmlContent);
}

/**
 * Generates a unique request ID for tracking operations
 */
export function generateRequestId(): string {
    return Math.random().toString(36).substring(2, 10);
}
