// smart-agent/src/llm.ts
// Streamlined multi-provider LLM caller: Gemini, OpenAI, Anthropic, DeepSeek
import { measure } from "measure-fn"

export async function callLLM(
    model: string,
    messages: Array<{ role: string; content: string }>,
    options: { temperature?: number; maxTokens?: number } = {},
): Promise<string> {
    const { temperature = 0.3, maxTokens = 8000 } = options

    // ── Gemini ──
    if (model.includes("gemini")) {
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
        if (!apiKey) throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY required")

        const systemInstruction = messages.find(m => m.role === "system")?.content
        const nonSystem = messages.filter(m => m.role !== "system" && m.content?.trim())

        // Merge consecutive same-role messages (Gemini rejects them)
        const contents: Array<{ role: string; parts: Array<{ text: string }> }> = []
        for (const m of nonSystem) {
            const role = m.role === "assistant" ? "model" : "user"
            const last = contents[contents.length - 1]
            if (last && last.role === role) {
                last.parts[0]!.text += "\n\n" + m.content
            } else {
                contents.push({ role, parts: [{ text: m.content }] })
            }
        }

        const body = {
            contents,
            generationConfig: { temperature, maxOutputTokens: maxTokens },
            ...(systemInstruction && { systemInstruction: { parts: [{ text: systemInstruction }] } }),
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
        const headers = { "Content-Type": "application/json", "x-goog-api-key": apiKey }
        const requestBody = JSON.stringify(body)

        return await measure.retry(`LLM ${model}`, { attempts: 4, delay: 5000, backoff: 2 }, async () => {
            const res = await fetch(url, { method: "POST", headers, body: requestBody })
            if (res.status === 429) throw new Error("Rate limited (429)")
            const data = await res.json() as any
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text
            if (!text) throw new Error(`Gemini failed: ${JSON.stringify(data).substring(0, 300)}`)
            return text
        })
    }

    // ── Anthropic ──
    if (model.includes("claude")) {
        const apiKey = process.env.ANTHROPIC_API_KEY
        if (!apiKey) throw new Error("ANTHROPIC_API_KEY required")

        const body = { model, max_tokens: maxTokens, messages, stream: false }
        const res = (await measure(`LLM ${model}`, () =>
            fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": apiKey,
                    "anthropic-version": "2023-06-01",
                },
                body: JSON.stringify(body),
            })
        ))!

        const data = await res.json() as any
        const text = data.content?.[0]?.text
        if (!text) throw new Error(`Anthropic failed: ${JSON.stringify(data).substring(0, 300)}`)
        return text
    }

    // ── DeepSeek ──
    if (model.includes("deepseek")) {
        const apiKey = process.env.DEEPSEEK_API_KEY
        if (!apiKey) throw new Error("DEEPSEEK_API_KEY required")

        const body = { model, temperature, messages, max_tokens: maxTokens, stream: false }
        const res = (await measure(`LLM ${model}`, () =>
            fetch("https://api.deepseek.com/v1/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
                body: JSON.stringify(body),
            })
        ))!

        const data = await res.json() as any
        const text = data.choices?.[0]?.message?.content
        if (!text) throw new Error(`DeepSeek failed: ${JSON.stringify(data).substring(0, 300)}`)
        return text
    }

    // ── Default: OpenAI-compatible /chat/completions ──
    // Works with OpenAI, OpenRouter, local models, or any compatible API
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error("OPENAI_API_KEY required for model: " + model)

    const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "")

    const isReasoning = model.includes("o4-") || model.includes("o3-")
    const body = isReasoning
        ? { model, temperature: 1.0, messages, max_completion_tokens: maxTokens, stream: false }
        : { model, temperature, messages, max_tokens: maxTokens, stream: false }

    const res = (await measure(`LLM ${model}`, () =>
        fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(body),
        })
    ))!

    const data = await res.json() as any
    const text = data.choices?.[0]?.message?.content
    if (!text) throw new Error(`LLM ${model} failed: ${JSON.stringify(data).substring(0, 300)}`)
    return text
}

/**
 * Streaming LLM call — yields text chunks as they arrive.
 * Currently supports Gemini streaming; other providers fall back to single-chunk.
 */
export async function* streamLLM(
    model: string,
    messages: Array<{ role: string; content: string }>,
    options: { temperature?: number; maxTokens?: number } = {},
): AsyncGenerator<string> {
    const { temperature = 0.3, maxTokens = 8000 } = options

    // ── Gemini Streaming ──
    if (model.includes("gemini")) {
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
        if (!apiKey) throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY required")

        const systemInstruction = messages.find(m => m.role === "system")?.content
        const nonSystem = messages.filter(m => m.role !== "system" && m.content?.trim())

        // Merge consecutive same-role messages (Gemini rejects them)
        const contents: Array<{ role: string; parts: Array<{ text: string }> }> = []
        for (const m of nonSystem) {
            const role = m.role === "assistant" ? "model" : "user"
            const last = contents[contents.length - 1]
            if (last && last.role === role) {
                last.parts[0]!.text += "\n\n" + m.content
            } else {
                contents.push({ role, parts: [{ text: m.content }] })
            }
        }

        const body = {
            contents,
            generationConfig: { temperature, maxOutputTokens: maxTokens },
            ...(systemInstruction && { systemInstruction: { parts: [{ text: systemInstruction }] } }),
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`
        const headers = { "Content-Type": "application/json", "x-goog-api-key": apiKey }

        const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) })
        if (res.status === 429) throw new Error("Rate limited (429)")
        if (!res.ok) {
            const errText = await res.text()
            throw new Error(`Gemini stream failed (${res.status}): ${errText.substring(0, 300)}`)
        }

        const reader = res.body!.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split("\n")
            buffer = lines.pop() || "" // keep incomplete last line

            for (const line of lines) {
                if (!line.startsWith("data: ")) continue
                const json = line.slice(6).trim()
                if (!json || json === "[DONE]") continue
                try {
                    const data = JSON.parse(json)
                    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
                    if (text) yield text
                } catch { /* skip unparseable chunks */ }
            }
        }
        return
    }

    // ── Non-streaming fallback for other providers ──
    const full = await callLLM(model, messages, options)
    yield full
}
