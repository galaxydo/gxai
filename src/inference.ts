// src/inference.ts
import { measure } from "measure-fn";
import type { ProgressCallback, StreamingCallback, StreamingUpdate } from './types';
import type { LLMType } from './types';

export async function callLLM(
  llm: LLMType | string,
  messages: Array<{ role: string; content: string }>,
  options: { temperature?: number; maxTokens?: number } = {},
  _measureFn?: any,
  streamingCallback?: StreamingCallback,
  progressCallback?: ProgressCallback,
  customFetch?: (url: string, options: RequestInit, measure: any, description: string, progressCallback?: ProgressCallback) => Promise<Response>
): Promise<string> {
  const { temperature = 0.7, maxTokens = 4000 } = options;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  let url = "";
  let body: Record<string, any> = {};

  if (llm.includes("claude")) {
    headers["x-api-key"] = process.env.ANTHROPIC_API_KEY!;
    headers["anthropic-version"] = "2023-06-01";
    url = "https://api.anthropic.com/v1/messages";
    body = { model: llm, max_tokens: maxTokens, messages, stream: !!streamingCallback };
  } else if (llm.includes("deepseek")) {
    headers["Authorization"] = `Bearer ${process.env.DEEPSEEK_API_KEY}`;
    url = "https://api.deepseek.com/v1/chat/completions";
    body = { model: llm, temperature, messages, max_tokens: maxTokens, stream: !!streamingCallback };
  } else if (llm.includes("gemini")) {
    // Gemini REST API — self-contained with measure.retry for rate limits
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY is required");
    headers["x-goog-api-key"] = apiKey;
    url = `https://generativelanguage.googleapis.com/v1beta/models/${llm}:generateContent`;

    // Convert messages to Gemini contents/parts format
    const systemInstruction = messages.find(m => m.role === "system")?.content;
    const nonSystemMsgs = messages.filter(m => m.role !== "system" && m.content?.trim());

    // Merge consecutive same-role messages (Gemini rejects them)
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
    for (const m of nonSystemMsgs) {
      const role = m.role === "assistant" ? "model" : "user";
      const last = contents[contents.length - 1];
      if (last && last.role === role) {
        last.parts[0]!.text += "\n\n" + m.content;
      } else {
        contents.push({ role, parts: [{ text: m.content }] });
      }
    }

    body = {
      contents,
      generationConfig: { temperature, maxOutputTokens: maxTokens },
      ...(systemInstruction && { systemInstruction: { parts: [{ text: systemInstruction }] } }),
    };

    const requestBodyStr = JSON.stringify(body);

    return await measure.retry(`Gemini ${llm}`, { attempts: 4, delay: 5000, backoff: 2 }, async () => {
      const res = await fetch(url, { method: "POST", headers, body: requestBodyStr });

      if (res.status === 429) {
        throw new Error(`Rate limited (429) — will retry`);
      }

      const data = await res.json() as any;
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error(`Gemini API call failed: ${JSON.stringify(data).substring(0, 300)}`);
      }
      return text;
    });
  } else {
    headers["Authorization"] = `Bearer ${process.env.OPENAI_API_KEY}`;
    url = "https://api.openai.com/v1/chat/completions";
    if (llm.includes('o4-')) {
      body = { model: llm, temperature: 1.0, messages, max_completion_tokens: maxTokens, stream: !!streamingCallback };
    } else {
      body = { model: llm, temperature, messages, max_tokens: maxTokens, stream: !!streamingCallback };
    }
  }

  const requestBodyStr = JSON.stringify(body);

  // Use customFetch (for x402 payment flow) or plain fetch
  const doFetch = customFetch
    ? (u: string, o: RequestInit, desc: string) => customFetch(u, o, null, desc, progressCallback)
    : (u: string, o: RequestInit, _desc: string) => fetch(u, o);

  if (!streamingCallback) {
    const content = await measure(`LLM call ${llm}`, async () => {
      const res = await doFetch(url, { method: "POST", headers, body: requestBodyStr }, `HTTP ${llm} API`);
      const data = await res.json() as any;
      const content = llm.includes("claude") ? data.content?.[0]?.text : data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error(`LLM API call to ${llm} failed. Unexpected response: ${JSON.stringify(data).substring(0, 200)}...`);
      }
      return content;
    });
    return content ?? '';
  } else {
    const response = await doFetch(url, { method: "POST", headers, body: requestBodyStr }, `HTTP ${llm} streaming`);

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No readable stream available");
    }

    const decoder = new TextDecoder();
    let fullResponse = "";
    let buffer = "";
    let tagStack: string[] = [];
    let currentTagName = "";
    let wordBuffer = "";
    let insideTag = false;

    const parseSseLine = (line: string): string => {
      if (!line.startsWith("data: ") || line.includes("[DONE]")) return "";
      try {
        const data = JSON.parse(line.slice(6));
        if (llm.includes("claude")) {
          return data.type === "content_block_delta" && data.delta?.text ? data.delta.text : "";
        } else {
          return data.choices?.[0]?.delta?.content || "";
        }
      } catch (e) {
        return "";
      }
    };

    const processChunk = (chunk: string) => {
      fullResponse += chunk;

      for (const char of chunk) {
        if (char === "<") {
          if (wordBuffer && tagStack.length > 0) {
            streamingCallback?.({ stage: "streaming", field: tagStack.join("_"), value: wordBuffer });
          }
          wordBuffer = "";
          insideTag = true;
          currentTagName = "";
        } else if (char === ">" && insideTag) {
          insideTag = false;
          if (currentTagName.startsWith("/")) {
            tagStack.pop();
          } else if (currentTagName.trim()) {
            tagStack.push(currentTagName.trim());
          }
          currentTagName = "";
          wordBuffer = "";
        } else if (insideTag) {
          currentTagName += char;
        } else if (tagStack.length > 0) {
          const currentField = tagStack.join("_");
          if (char === " " || char === "\n") {
            if (wordBuffer) {
              streamingCallback?.({ stage: "streaming", field: currentField, value: wordBuffer });
            }
            streamingCallback?.({ stage: "streaming", field: currentField, value: char });
            wordBuffer = "";
          } else {
            wordBuffer += char;
          }
        }
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const content = parseSseLine(line);
          if (content) processChunk(content);
        }
      }
    } finally {
      reader.releaseLock();
      if (buffer) {
        const content = parseSseLine(buffer);
        if (content) processChunk(content);
      }
      if (wordBuffer && tagStack.length > 0 && streamingCallback) {
        streamingCallback({ stage: "streaming", field: tagStack.join("_"), value: wordBuffer });
      }
    }

    return fullResponse;
  }
}

if (import.meta.env.NODE_ENV === "test") {
  const { test, expect } = await import('bun:test');

  test('callLLM non-streaming mock', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'test response' } }] }))
    ) as any;
    try {
      const result = await callLLM('gpt-4o-mini', [{ role: 'user', content: 'hello' }], {});
      expect(result).toBe('test response');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('callLLM with streaming mock', async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices": [{"delta": {"content": "<response>"}}]}\n\n'));
        controller.enqueue(new TextEncoder().encode('data: {"choices": [{"delta": {"content": "hello world"}}]}\n\n'));
        controller.enqueue(new TextEncoder().encode('data: {"choices": [{"delta": {"content": "</response>"}}]}\n\n'));
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.close();
      }
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(mockStream)) as any;
    try {
      const streamingUpdates: StreamingUpdate[] = [];
      const result = await callLLM(
        'gpt-4o-mini',
        [{ role: 'user', content: 'hello' }],
        {},
        null,
        (update) => streamingUpdates.push(update)
      );
      expect(result).toContain('hello world');
      expect(streamingUpdates.length).toBeGreaterThan(0);
      expect(streamingUpdates[0].field).toBe('response');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}
