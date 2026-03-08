// src/inference.ts
import { measure } from "measure-fn";
import type { LLMType, ProgressCallback, StreamingCallback, StreamingUpdate, TokenUsage } from './types';

/** Last token usage from the most recent callLLM invocation */
export let lastTokenUsage: TokenUsage | null = null;

/** Extract token usage from provider-specific response format */
function extractUsage(llm: string, data: any): TokenUsage | undefined {
  // OpenAI / DeepSeek format
  if (data?.usage?.prompt_tokens !== undefined) {
    return {
      inputTokens: data.usage.prompt_tokens,
      outputTokens: data.usage.completion_tokens || 0,
      totalTokens: data.usage.total_tokens || (data.usage.prompt_tokens + (data.usage.completion_tokens || 0)),
    };
  }
  // Anthropic format
  if (data?.usage?.input_tokens !== undefined) {
    return {
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens || 0,
      totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
    };
  }
  // Gemini format
  if (data?.usageMetadata?.promptTokenCount !== undefined) {
    return {
      inputTokens: data.usageMetadata.promptTokenCount,
      outputTokens: data.usageMetadata.candidatesTokenCount || 0,
      totalTokens: data.usageMetadata.totalTokenCount || (data.usageMetadata.promptTokenCount + (data.usageMetadata.candidatesTokenCount || 0)),
    };
  }
  return undefined;
}

export async function callLLM(
  llm: LLMType | string,
  messages: Array<{ role: string; content: string }>,
  options: { temperature?: number; maxTokens?: number; response_format?: any } = {},
  _measureFn?: any,
  streamingCallback?: StreamingCallback,
  progressCallback?: ProgressCallback,
  customFetch?: (url: string, options: RequestInit, measure: any, description: string, progressCallback?: ProgressCallback) => Promise<Response>
): Promise<string> {
  lastTokenUsage = null;
  const { temperature = 0.7, maxTokens = 4000, response_format } = options;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  let url = "";
  let body: Record<string, any> = {};

  if (llm.includes("claude")) {
    if (!process.env.ANTHROPIC_API_KEY && process.env.NODE_ENV !== "test") throw new Error("ANTHROPIC_API_KEY environment variable is required");
    headers["x-api-key"] = process.env.ANTHROPIC_API_KEY || "test";
    headers["anthropic-version"] = "2023-06-01";
    url = "https://api.anthropic.com/v1/messages";
    const systemMessage = messages.find(m => m.role === "system")?.content;
    const anthropicMessages = messages.filter(m => m.role !== "system");
    body = {
      model: llm,
      max_tokens: maxTokens,
      messages: anthropicMessages,
      stream: !!streamingCallback,
      ...(systemMessage && { system: systemMessage })
    };
  } else if (llm.includes("deepseek")) {
    if (!process.env.DEEPSEEK_API_KEY && process.env.NODE_ENV !== "test") throw new Error("DEEPSEEK_API_KEY environment variable is required");
    headers["Authorization"] = `Bearer ${process.env.DEEPSEEK_API_KEY || "test"}`;
    url = "https://api.deepseek.com/v1/chat/completions";
    body = { model: llm, temperature, messages, max_tokens: maxTokens, stream: !!streamingCallback, ...(streamingCallback && { stream_options: { include_usage: true } }) };
  } else if (llm.includes("gemini")) {
    // Gemini REST API — self-contained with measure.retry for rate limits
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey && process.env.NODE_ENV !== "test") throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY is required");
    headers["x-goog-api-key"] = apiKey || "test";
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
      lastTokenUsage = extractUsage(llm, data) || null;
      return text;
    });
  } else {
    if (!process.env.OPENAI_API_KEY && process.env.NODE_ENV !== "test") throw new Error("OPENAI_API_KEY environment variable is required");
    headers["Authorization"] = `Bearer ${process.env.OPENAI_API_KEY || "test"}`;
    url = "https://api.openai.com/v1/chat/completions";
    if (llm.includes('o4-')) {
      body = { model: llm, temperature: 1.0, messages, max_completion_tokens: maxTokens, stream: !!streamingCallback, ...(streamingCallback && { stream_options: { include_usage: true } }) };
    } else {
      body = { model: llm, temperature, messages, max_tokens: maxTokens, stream: !!streamingCallback, ...(streamingCallback && { stream_options: { include_usage: true } }) };
    }
    if (response_format) {
      body.response_format = response_format;
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
      lastTokenUsage = extractUsage(llm, data) || null;
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

    // Track streaming usage across SSE events
    const streamUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let hasStreamUsage = false;

    const parseSseLine = (line: string): string => {
      if (!line.startsWith("data: ") || line.includes("[DONE]")) return "";
      try {
        const data = JSON.parse(line.slice(6));

        // Extract usage from streaming chunks
        if (llm.includes("claude")) {
          // Anthropic: message_start has input_tokens, message_delta has output_tokens
          if (data.type === "message_start" && data.message?.usage) {
            streamUsage.inputTokens = data.message.usage.input_tokens || 0;
            hasStreamUsage = true;
          }
          if (data.type === "message_delta" && data.usage) {
            streamUsage.outputTokens = data.usage.output_tokens || 0;
            streamUsage.totalTokens = streamUsage.inputTokens + streamUsage.outputTokens;
            hasStreamUsage = true;
          }
          return data.type === "content_block_delta" && data.delta?.text ? data.delta.text : "";
        } else {
          // OpenAI / DeepSeek: usage appears in final chunk when stream_options.include_usage is true
          if (data.usage) {
            streamUsage.inputTokens = data.usage.prompt_tokens || 0;
            streamUsage.outputTokens = data.usage.completion_tokens || 0;
            streamUsage.totalTokens = data.usage.total_tokens || (streamUsage.inputTokens + streamUsage.outputTokens);
            hasStreamUsage = true;
          }
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

    // Set token usage from streaming
    if (hasStreamUsage) {
      lastTokenUsage = streamUsage;
    }

    return fullResponse;
  }
}

/** Configuration for provider fallback chain */
export interface FallbackConfig {
  /** Ordered list of LLM providers to try. First is primary, rest are fallbacks. */
  providers: Array<LLMType | string>;
  /** Optional callback when a fallback is triggered */
  onFallback?: (failedProvider: string, error: string, nextProvider: string) => void;
}

/**
 * Call LLM with automatic provider fallback.
 * Tries each provider in the chain sequentially until one succeeds.
 * Preserves lastTokenUsage from the successful call.
 */
export async function callLLMWithFallback(
  fallback: FallbackConfig,
  messages: Array<{ role: string; content: string }>,
  options: { temperature?: number; maxTokens?: number; response_format?: any } = {},
  _measureFn?: any,
  streamingCallback?: StreamingCallback,
  progressCallback?: ProgressCallback,
  customFetch?: (url: string, options: RequestInit, measure: any, description: string, progressCallback?: ProgressCallback) => Promise<Response>
): Promise<string> {
  const { providers, onFallback } = fallback;
  if (!providers.length) throw new Error('FallbackConfig requires at least one provider');

  let lastError: Error | null = null;

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i]!;
    try {
      return await callLLM(provider, messages, options, _measureFn, streamingCallback, progressCallback, customFetch);
    } catch (err: any) {
      lastError = err;
      const errMsg = err.message || String(err);

      if (i < providers.length - 1) {
        const next = providers[i + 1]!;
        console.warn(`[gxai] Provider "${provider}" failed: ${errMsg}. Falling back to "${next}"`);
        onFallback?.(provider, errMsg, next);
      }
    }
  }

  throw lastError || new Error('All providers in fallback chain failed');
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
      expect(streamingUpdates[0]!.field).toBe('response');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}
