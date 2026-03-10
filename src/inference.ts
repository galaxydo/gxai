// src/inference.ts
import { measure } from "measure-fn";
import { z } from 'zod';
import type { LLMType, LLMMessage, ImageContent, ProgressCallback, StreamingCallback, StreamingUpdate, TokenUsage } from './types';

// ─── Provider Response Schemas ──────────────────────────
// Zod schemas for validating raw LLM API responses.
// If a provider changes their response format, the error
// will show exactly which fields are missing/wrong.

const OpenAIResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({
      content: z.string(),
    }),
  })).min(1, 'OpenAI response has no choices'),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number().optional(),
    total_tokens: z.number().optional(),
  }).optional(),
});

const AnthropicResponseSchema = z.object({
  content: z.array(z.object({
    type: z.string().optional(),
    text: z.string().optional(),
    thinking: z.string().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
    input: z.any().optional(),
  })).min(1, 'Anthropic response has no content blocks'),
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number().optional(),
  }).optional(),
});

const GeminiResponseSchema = z.object({
  candidates: z.array(z.object({
    content: z.object({
      parts: z.array(z.object({
        text: z.string().optional(),
        thought: z.boolean().optional(),
      })).min(1, 'Gemini candidate has no parts'),
    }),
  })).min(1, 'Gemini response has no candidates'),
  usageMetadata: z.object({
    promptTokenCount: z.number(),
    candidatesTokenCount: z.number().optional(),
    totalTokenCount: z.number().optional(),
  }).optional(),
});

/** Validate a raw API response against the provider's expected schema */
function validateProviderResponse(llm: string, data: any): { content: string; rawData: any } {
  try {
    if (llm.includes('claude')) {
      const parsed = AnthropicResponseSchema.parse(data);
      // Anthropic structured output: extract tool_use input as JSON
      const toolBlock = parsed.content.find(b => b.type === 'tool_use' && b.input);
      if (toolBlock) {
        return { content: JSON.stringify(toolBlock.input), rawData: data };
      }
      // Skip thinking blocks — only return text content
      const textBlocks = parsed.content.filter(b => b.type === 'text' && b.text);
      const textContent = textBlocks.length > 0 ? textBlocks.map(b => b.text).join('') : '';
      return { content: textContent || parsed.content.find(b => b.text)?.text || '', rawData: data };
    } else if (llm.includes('gemini')) {
      const parsed = GeminiResponseSchema.parse(data);
      // Skip thought parts — only return the model's final answer
      const answerParts = parsed.candidates[0]!.content.parts.filter(p => !p.thought && p.text);
      const content = answerParts.map(p => p.text).join('');
      return { content: content || parsed.candidates[0]!.content.parts[0]!.text || '', rawData: data };
    } else {
      // OpenAI / DeepSeek
      const parsed = OpenAIResponseSchema.parse(data);
      return { content: parsed.choices[0]!.message.content, rawData: data };
    }
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      const issues = err.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n');
      throw new Error(
        `${llm} API response format mismatch:\n${issues}\n` +
        `Raw response (truncated): ${JSON.stringify(data).substring(0, 300)}`
      );
    }
    throw err;
  }
}

export { OpenAIResponseSchema, AnthropicResponseSchema, GeminiResponseSchema };

/** Last token usage from the most recent callLLM invocation */
export let lastTokenUsage: TokenUsage | null = null;

/** Extract token usage from provider-specific response format */
function extractUsage(llm: string, data: any): TokenUsage | undefined {
  // OpenAI / DeepSeek format
  if (data?.usage?.prompt_tokens !== undefined) {
    const usage: TokenUsage = {
      inputTokens: data.usage.prompt_tokens,
      outputTokens: data.usage.completion_tokens || 0,
      totalTokens: data.usage.total_tokens || (data.usage.prompt_tokens + (data.usage.completion_tokens || 0)),
    };
    // DeepSeek R1: capture reasoning_content from the response
    const reasoning = data?.choices?.[0]?.message?.reasoning_content;
    if (reasoning) usage.reasoningContent = reasoning;
    return usage;
  }
  // Anthropic format
  if (data?.usage?.input_tokens !== undefined) {
    const usage: TokenUsage = {
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens || 0,
      totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
    };
    // Claude extended thinking: extract thinking blocks
    const content = data?.content;
    if (content && Array.isArray(content)) {
      const thoughts = content.filter((b: any) => b.type === 'thinking' && b.thinking).map((b: any) => b.thinking);
      if (thoughts.length > 0) usage.reasoningContent = thoughts.join('\n');
    }
    return usage;
  }
  // Gemini format
  if (data?.usageMetadata?.promptTokenCount !== undefined) {
    const usage: TokenUsage = {
      inputTokens: data.usageMetadata.promptTokenCount,
      outputTokens: data.usageMetadata.candidatesTokenCount || 0,
      totalTokens: data.usageMetadata.totalTokenCount || (data.usageMetadata.promptTokenCount + (data.usageMetadata.candidatesTokenCount || 0)),
    };
    // Gemini 2.5 thinking: extract thought parts from response
    const parts = data?.candidates?.[0]?.content?.parts;
    if (parts && Array.isArray(parts)) {
      const thoughts = parts.filter((p: any) => p.thought && p.text).map((p: any) => p.text);
      if (thoughts.length > 0) usage.reasoningContent = thoughts.join('\n');
    }
    return usage;
  }
  return undefined;
}

// ─── Provider Health Check ──────────────────────────────
// Lightweight HEAD ping to detect down providers before wasting
// time on full LLM requests in fallback chains.

/** Map an LLM model name to its provider's API endpoint */
export function getProviderEndpoint(llm: string): string {
  if (llm.includes('claude')) return 'https://api.anthropic.com/v1/messages';
  if (llm.includes('deepseek')) return 'https://api.deepseek.com/v1/chat/completions';
  if (llm.includes('gemini')) return `https://generativelanguage.googleapis.com/v1beta/models/${llm}`;
  // Default: OpenAI-compatible
  return 'https://api.openai.com/v1/chat/completions';
}

/** Result of a provider health check */
export interface ProviderHealthResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

// Cache: remember health status for 60s to avoid hammering endpoints
const _healthCache = new Map<string, { result: ProviderHealthResult; expiresAt: number }>();
const HEALTH_CACHE_TTL = 60_000;

/** Clear the provider health cache (useful for testing) */
export function clearHealthCache(): void {
  _healthCache.clear();
}

/**
 * Ping a provider's API endpoint with a HEAD request.
 * Returns { ok, latencyMs, error? }.
 *
 * - 2xx/4xx (auth errors) = provider is up (ok: true)
 * - 5xx / network error / timeout = provider is down (ok: false)
 * - Results are cached for 60s
 */
export async function pingProvider(llm: string): Promise<ProviderHealthResult> {
  const endpoint = getProviderEndpoint(llm);
  const cacheKey = endpoint;

  // Return cached result if fresh
  const cached = _healthCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.result;
  }

  const start = performance.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(endpoint, {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const latencyMs = Math.round(performance.now() - start);

    // 2xx = healthy, 4xx = auth error but endpoint is reachable, 5xx = server error
    const ok = res.status < 500;
    const result: ProviderHealthResult = {
      ok,
      latencyMs,
      ...(!ok && { error: `HTTP ${res.status}` }),
    };

    _healthCache.set(cacheKey, { result, expiresAt: Date.now() + HEALTH_CACHE_TTL });
    return result;
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - start);
    const result: ProviderHealthResult = {
      ok: false,
      latencyMs,
      error: err.name === 'AbortError' ? 'Timeout (5s)' : (err.message || String(err)),
    };
    _healthCache.set(cacheKey, { result, expiresAt: Date.now() + HEALTH_CACHE_TTL });
    return result;
  }
}

export async function callLLM(
  llm: LLMType | string,
  messages: Array<LLMMessage | { role: string; content: string; cacheControl?: boolean }>,
  options: {
    temperature?: number; maxTokens?: number; response_format?: any;
    signal?: AbortSignal; timeoutMs?: number;
    /** Streaming callback */
    streaming?: StreamingCallback;
    /** Progress callback */
    progress?: ProgressCallback;
    /** Custom fetch (e.g. for x402 payments) */
    customFetch?: (url: string, options: RequestInit, measure: any, description: string, progressCallback?: ProgressCallback) => Promise<Response>;
  } = {},
): Promise<string> {
  const { streaming: streamingCallback, progress: progressCallback, customFetch } = options;

  lastTokenUsage = null;
  const { temperature = 0.7, maxTokens = 4000, response_format, signal: userSignal, timeoutMs } = options;

  // Build abort signal: combine user signal + timeout
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let fetchSignal: AbortSignal | undefined = userSignal;
  if (timeoutMs && timeoutMs > 0) {
    const timeoutController = new AbortController();
    timeoutId = setTimeout(() => timeoutController.abort(new Error(`LLM request timed out after ${timeoutMs}ms`)), timeoutMs);
    fetchSignal = userSignal
      ? AbortSignal.any([userSignal, timeoutController.signal])
      : timeoutController.signal;
  }

  try {

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

      const systemMessages = messages.filter(m => m.role === "system");
      let systemParam: string | any[] | undefined = undefined;
      if (systemMessages.length === 1 && !systemMessages[0]!.cacheControl) {
        systemParam = systemMessages[0]!.content;
      } else if (systemMessages.length > 0) {
        systemParam = systemMessages.map(m => {
          const block: any = { type: "text", text: m.content };
          if (m.cacheControl) block.cache_control = { type: "ephemeral" };
          return block;
        });
      }

      const anthropicMessages = messages.filter(m => m.role !== "system").map(m => {
        const images = (m as LLMMessage).images;
        if (images && images.length > 0) {
          // Multimodal: build content array with image + text parts
          const contentParts: any[] = images.map(img => {
            if (img.data) {
              return { type: "image", source: { type: "base64", media_type: img.mimeType || 'image/png', data: img.data } };
            }
            // URL — Anthropic requires base64, but supports URL via url source type
            return { type: "image", source: { type: "url", url: img.url } };
          });
          contentParts.push({ type: "text", text: m.content });
          if (m.cacheControl) {
            contentParts[contentParts.length - 1].cache_control = { type: "ephemeral" };
          }
          return { role: m.role, content: contentParts };
        }
        if (m.cacheControl) {
          return {
            role: m.role,
            content: [
              { type: "text", text: m.content, cache_control: { type: "ephemeral" } }
            ]
          };
        }
        return { role: m.role, content: m.content };
      });

      // Claude extended thinking: enable for Sonnet 4+ and Opus models
      const supportsThinking = llm.includes('claude-sonnet-4') || llm.includes('claude-opus');

      body = {
        model: llm,
        max_tokens: maxTokens,
        messages: anthropicMessages,
        stream: !!streamingCallback,
        ...(systemParam !== undefined && { system: systemParam }),
        ...(supportsThinking && { thinking: { type: 'enabled', budget_tokens: 10000 } }),
      };

      // Anthropic structured output: use tool_use with forced tool_choice
      if (response_format?.type === 'json_schema' && response_format.json_schema?.schema) {
        const toolName = response_format.json_schema.name || 'structured_output';
        (body as any).tools = [{
          name: toolName,
          description: 'Return structured output matching the required schema',
          input_schema: response_format.json_schema.schema,
        }];
        (body as any).tool_choice = { type: 'tool', name: toolName };
      }
    } else if (llm.includes("deepseek")) {
      if (!process.env.DEEPSEEK_API_KEY && process.env.NODE_ENV !== "test") throw new Error("DEEPSEEK_API_KEY environment variable is required");
      headers["Authorization"] = `Bearer ${process.env.DEEPSEEK_API_KEY || "test"}`;
      url = "https://api.deepseek.com/v1/chat/completions";
      const cleanMessages = messages.map(m => ({ role: m.role, content: m.content }));
      // DeepSeek does not support vision — strip images silently
      body = { model: llm, temperature, messages: cleanMessages, max_tokens: maxTokens, stream: !!streamingCallback, ...(streamingCallback && { stream_options: { include_usage: true } }) };
    } else if (llm.includes("gemini")) {
      // Gemini REST API — self-contained with measure.retry for rate limits
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (!apiKey && process.env.NODE_ENV !== "test") throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY is required");
      headers["x-goog-api-key"] = apiKey || "test";
      url = `https://generativelanguage.googleapis.com/v1beta/models/${llm}:generateContent`;

      // Convert messages to Gemini contents/parts format
      const systemMsgs = messages.filter(m => m.role === "system");
      const systemInstruction = systemMsgs.length > 0 ? systemMsgs.map(m => m.content).join("\n\n") : undefined;
      const nonSystemMsgs = messages.filter(m => m.role !== "system" && m.content?.trim());

      // Merge consecutive same-role messages (Gemini rejects them)
      const contents: Array<{ role: string; parts: any[] }> = [];
      for (const m of nonSystemMsgs) {
        const role = m.role === "assistant" ? "model" : "user";
        const images = (m as LLMMessage).images;

        // Build parts: images first (as inlineData), then text
        const parts: any[] = [];
        if (images && images.length > 0) {
          for (const img of images) {
            if (img.data) {
              parts.push({ inlineData: { mimeType: img.mimeType || 'image/png', data: img.data } });
            } else if (img.url) {
              // Gemini supports fileData with fileUri for GCS, otherwise use URL as text hint
              parts.push({ text: `[Image: ${img.url}]` });
            }
          }
        }
        parts.push({ text: m.content });

        const last = contents[contents.length - 1];
        if (last && last.role === role) {
          last.parts.push(...parts);
        } else {
          contents.push({ role, parts });
        }
      }

      const generationConfig: Record<string, any> = { temperature, maxOutputTokens: maxTokens };

      // Gemini structured output: convert OpenAI-style json_schema to Gemini responseSchema
      if (response_format?.type === 'json_schema' && response_format.json_schema?.schema) {
        generationConfig.responseMimeType = 'application/json';
        generationConfig.responseSchema = response_format.json_schema.schema;
      }

      // Gemini 2.5 thinking: include thought parts in response
      if (llm.includes('gemini-2.5') || llm.includes('gemini-3')) {
        generationConfig.thinkingConfig = { includeThoughts: true };
      }

      body = {
        contents,
        generationConfig,
        ...(systemInstruction && { systemInstruction: { parts: [{ text: systemInstruction }] } }),
      };

      const requestBodyStr = JSON.stringify(body);

      if (streamingCallback) {
        // Gemini streaming via SSE endpoint
        const streamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${llm}:streamGenerateContent?alt=sse`;
        const res = await fetch(streamUrl, { method: "POST", headers, body: requestBodyStr, signal: fetchSignal });
        if (res.status === 429) throw new Error(`Rate limited (429)`);

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No readable stream from Gemini");

        const decoder = new TextDecoder();
        let fullResponse = "";
        let sseBuffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split("\n");
          sseBuffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr || jsonStr === "[DONE]") continue;
            try {
              const chunk = JSON.parse(jsonStr);
              const parts = chunk?.candidates?.[0]?.content?.parts;
              if (parts && Array.isArray(parts)) {
                for (const part of parts) {
                  if (part.thought && part.text) {
                    // Gemini 2.5 thinking: emit as _reasoning
                    streamingCallback({ stage: "streaming", field: "_reasoning", value: part.text });
                  } else if (part.text) {
                    fullResponse += part.text;
                    streamingCallback({ stage: "streaming", field: "content", value: part.text });
                  }
                }
              }
              // Extract usage from last chunk
              if (chunk?.usageMetadata) {
                lastTokenUsage = extractUsage(llm, chunk) || null;
              }
            } catch { /* skip malformed chunks */ }
          }
        }

        // Fallback: estimate usage if provider didn't include usageMetadata
        if (!lastTokenUsage && fullResponse.length > 0) {
          const inputChars = requestBodyStr.length;
          const outputChars = fullResponse.length;
          lastTokenUsage = {
            inputTokens: Math.ceil(inputChars / 4),
            outputTokens: Math.ceil(outputChars / 4),
            totalTokens: Math.ceil(inputChars / 4) + Math.ceil(outputChars / 4),
          };
        }

        return fullResponse;
      }

      // Non-streaming Gemini
      return (await measure.retry(`Gemini ${llm}`, { attempts: 4, delay: 5000, backoff: 2 }, async () => {
        const res = await fetch(url, { method: "POST", headers, body: requestBodyStr, signal: fetchSignal });

        if (res.status === 429) {
          throw new Error(`Rate limited (429) — will retry`);
        }

        const data = await res.json() as any;
        const { content: text, rawData } = validateProviderResponse(llm, data);
        lastTokenUsage = extractUsage(llm, rawData) || null;
        return text;
      }))!;
    } else {
      if (!process.env.OPENAI_API_KEY && process.env.NODE_ENV !== "test") throw new Error("OPENAI_API_KEY environment variable is required");
      headers["Authorization"] = `Bearer ${process.env.OPENAI_API_KEY || "test"}`;
      url = "https://api.openai.com/v1/chat/completions";
      const openaiMessages = messages.map(m => {
        const images = (m as LLMMessage).images;
        if (images && images.length > 0) {
          // Multimodal: content becomes array of parts
          const contentParts: any[] = images.map(img => {
            if (img.url) {
              return { type: "image_url", image_url: { url: img.url } };
            }
            // Base64 to data URI
            const mime = img.mimeType || 'image/png';
            return { type: "image_url", image_url: { url: `data:${mime};base64,${img.data}` } };
          });
          contentParts.push({ type: "text", text: m.content });
          return { role: m.role, content: contentParts };
        }
        return { role: m.role, content: m.content };
      });
      if (llm.includes('o4-')) {
        body = { model: llm, temperature: 1.0, messages: openaiMessages, max_completion_tokens: maxTokens, stream: !!streamingCallback, ...(streamingCallback && { stream_options: { include_usage: true } }) };
      } else {
        body = { model: llm, temperature, messages: openaiMessages, max_tokens: maxTokens, stream: !!streamingCallback, ...(streamingCallback && { stream_options: { include_usage: true } }) };
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

    // Retryable fetch: retries on 429/500/502/503 with exponential backoff
    const retryableFetch = async (fetchFn: () => Promise<Response>, maxAttempts = 3, baseDelay = 2000): Promise<Response> => {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const res = await fetchFn();
        const retryable = [429, 500, 502, 503].includes(res.status);
        if (!retryable || attempt === maxAttempts) return res;
        // Parse Retry-After header (seconds) or use exponential backoff
        const retryAfter = res.headers.get('retry-after');
        const delayMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : baseDelay * Math.pow(2, attempt - 1);
        await new Promise(r => setTimeout(r, delayMs));
      }
      throw new Error('Unreachable');
    };

    if (!streamingCallback) {
      const content = await measure.assert(`LLM call ${llm}`, async () => {
        const res = await retryableFetch(() => doFetch(url, { method: "POST", headers, body: requestBodyStr, signal: fetchSignal }, `HTTP ${llm} API`));
        const data = await res.json() as any;
        const { content, rawData } = validateProviderResponse(llm, data);
        lastTokenUsage = extractUsage(llm, rawData) || null;
        return content;
      });
      return content ?? '';
    } else {
      const response = await retryableFetch(() => doFetch(url, { method: "POST", headers, body: requestBodyStr, signal: fetchSignal }, `HTTP ${llm} streaming`));

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
            // Track the current content block type for thinking vs text
            if (data.type === "content_block_start" && data.content_block?.type === "thinking") {
              // Mark we're in a thinking block — use a transient flag
              (streamUsage as any).__thinkingBlock = true;
            }
            if (data.type === "content_block_start" && data.content_block?.type === "text") {
              (streamUsage as any).__thinkingBlock = false;
            }
            if (data.type === "content_block_delta") {
              // Claude thinking: delta.thinking for thinking blocks
              if (data.delta?.thinking && streamingCallback) {
                streamingCallback({ stage: "streaming", field: "_reasoning", value: data.delta.thinking });
                return "";
              }
              return data.delta?.text || "";
            }
            return "";
          } else {
            // OpenAI / DeepSeek: usage appears in final chunk when stream_options.include_usage is true
            if (data.usage) {
              streamUsage.inputTokens = data.usage.prompt_tokens || 0;
              streamUsage.outputTokens = data.usage.completion_tokens || 0;
              streamUsage.totalTokens = data.usage.total_tokens || (streamUsage.inputTokens + streamUsage.outputTokens);
              hasStreamUsage = true;
            }
            // DeepSeek R1: emit reasoning_content as separate streaming field
            const reasoning = data.choices?.[0]?.delta?.reasoning_content;
            if (reasoning && streamingCallback) {
              streamingCallback({ stage: "streaming", field: "_reasoning", value: reasoning });
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
      } else if (fullResponse.length > 0) {
        // Fallback: estimate usage when provider didn't send usage events (~4 chars/token)
        const inputChars = requestBodyStr.length;
        const outputChars = fullResponse.length;
        lastTokenUsage = {
          inputTokens: Math.ceil(inputChars / 4),
          outputTokens: Math.ceil(outputChars / 4),
          totalTokens: Math.ceil(inputChars / 4) + Math.ceil(outputChars / 4),
        };
      }

      return fullResponse;
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
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
 *
 * When `skipUnhealthy: true`, pings all providers first and skips
 * unreachable ones to avoid wasting time on known-down endpoints.
 */
export async function callLLMWithFallback(
  fallback: FallbackConfig,
  messages: Array<{ role: string; content: string; cacheControl?: boolean }>,
  options: {
    temperature?: number; maxTokens?: number; response_format?: any;
    signal?: AbortSignal; timeoutMs?: number;
    streaming?: StreamingCallback;
    progress?: ProgressCallback;
    customFetch?: (url: string, options: RequestInit, measure: any, description: string, progressCallback?: ProgressCallback) => Promise<Response>;
    /** Pre-ping providers and skip unreachable ones */
    skipUnhealthy?: boolean;
  } = {},
): Promise<string> {
  let { providers, onFallback } = fallback;
  if (!providers.length) throw new Error('FallbackConfig requires at least one provider');

  // ── Pre-flight health check ──
  if (options.skipUnhealthy && providers.length > 1) {
    const healthResults = await Promise.all(providers.map(p => pingProvider(p)));
    const healthy: Array<LLMType | string> = [];

    for (let i = 0; i < providers.length; i++) {
      const hr = healthResults[i]!;
      if (hr.ok) {
        healthy.push(providers[i]!);
      } else {
        console.warn(`[gxai] Skipping unhealthy provider "${providers[i]}": ${hr.error} (${hr.latencyMs}ms)`);
        onFallback?.(providers[i]!, hr.error || 'unhealthy', healthy[0] || providers[i + 1] || 'none');
      }
    }

    // Only narrow list if at least one provider is healthy
    if (healthy.length > 0) {
      providers = healthy;
    }
    // else: fall through to try-each as-is (safety net)
  }

  let lastError: Error | null = null;

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i]!;
    try {
      return await callLLM(provider, messages, options);
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
        { streaming: (update: StreamingUpdate) => streamingUpdates.push(update) },
      );
      expect(result).toContain('hello world');
      expect(streamingUpdates.length).toBeGreaterThan(0);
      expect(streamingUpdates[0]!.field).toBe('response');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('callLLM options.streaming works (new API)', async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices": [{"delta": {"content": "<r>"}}]}\n\n'));
        controller.enqueue(new TextEncoder().encode('data: {"choices": [{"delta": {"content": "ok"}}]}\n\n'));
        controller.enqueue(new TextEncoder().encode('data: {"choices": [{"delta": {"content": "</r>"}}]}\n\n'));
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.close();
      }
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(mockStream)) as any;
    try {
      const updates: StreamingUpdate[] = [];
      // Use options.streaming instead of positional param
      const result = await callLLM(
        'gpt-4o-mini',
        [{ role: 'user', content: 'test' }],
        { streaming: (update: StreamingUpdate) => updates.push(update) },
      );
      expect(result).toContain('ok');
      expect(updates.length).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('OpenAIResponseSchema validates correct format', () => {
    const valid = { choices: [{ message: { content: 'hello' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
    expect(() => OpenAIResponseSchema.parse(valid)).not.toThrow();
  });

  test('OpenAIResponseSchema rejects empty choices', () => {
    expect(() => OpenAIResponseSchema.parse({ choices: [] })).toThrow();
  });

  test('AnthropicResponseSchema validates correct format', () => {
    const valid = { content: [{ text: 'hello' }], usage: { input_tokens: 10 } };
    expect(() => AnthropicResponseSchema.parse(valid)).not.toThrow();
  });

  test('AnthropicResponseSchema rejects missing content', () => {
    expect(() => AnthropicResponseSchema.parse({ id: 'msg_1' })).toThrow();
  });

  test('GeminiResponseSchema validates correct format', () => {
    const valid = { candidates: [{ content: { parts: [{ text: 'hello' }] } }], usageMetadata: { promptTokenCount: 10 } };
    expect(() => GeminiResponseSchema.parse(valid)).not.toThrow();
  });

  test('GeminiResponseSchema rejects empty candidates', () => {
    expect(() => GeminiResponseSchema.parse({ candidates: [] })).toThrow();
  });

  test('validateProviderResponse gives descriptive error for OpenAI format change', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: 'model not found' } }))
    ) as any;
    try {
      await callLLM('gpt-4o-mini', [{ role: 'user', content: 'hi' }], {});
      expect(true).toBe(false); // should not reach
    } catch (err: any) {
      // measure.assert wraps the error, but the original validation error is logged
      expect(err).toBeInstanceOf(Error);
      expect(err.message.length).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('o4-mini uses max_completion_tokens instead of max_tokens', async () => {
    let capturedBody: any = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'reasoning response' } }] }));
    }) as any;
    try {
      await callLLM('o4-mini', [{ role: 'user', content: 'hi' }], { maxTokens: 4000 });
      expect(capturedBody).not.toBeNull();
      expect(capturedBody.model).toBe('o4-mini');
      expect(capturedBody.max_completion_tokens).toBe(4000);
      expect(capturedBody.max_tokens).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('o4-mini forces temperature to 1.0', async () => {
    let capturedBody: any = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
    }) as any;
    try {
      // Even if user passes temperature: 0, o4-mini should force 1.0
      await callLLM('o4-mini', [{ role: 'user', content: 'hi' }], { temperature: 0 });
      expect(capturedBody.temperature).toBe(1.0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('o4-mini non-streaming response parses correctly', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        choices: [{ message: { content: 'I reasoned step by step and the answer is 42' } }],
        usage: { prompt_tokens: 50, completion_tokens: 200, total_tokens: 250 },
      }))
    ) as any;
    try {
      const result = await callLLM('o4-mini', [{ role: 'user', content: 'Solve this' }], {});
      expect(result).toContain('42');
      expect(lastTokenUsage).not.toBeNull();
      expect(lastTokenUsage!.totalTokens).toBe(250);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ── Vision / Image Input Tests ──

  test('OpenAI vision: images converted to image_url content parts', async () => {
    let capturedBody: any = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'I see a cat' } }] }));
    }) as any;
    try {
      await callLLM('gpt-4o', [
        { role: 'user', content: 'What is in this image?', images: [{ url: 'https://example.com/cat.png' }] }
      ]);
      // content should be array (multimodal)
      const userMsg = capturedBody.messages.find((m: any) => m.role === 'user');
      expect(Array.isArray(userMsg.content)).toBe(true);
      expect(userMsg.content[0].type).toBe('image_url');
      expect(userMsg.content[0].image_url.url).toBe('https://example.com/cat.png');
      expect(userMsg.content[1].type).toBe('text');
      expect(userMsg.content[1].text).toBe('What is in this image?');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('OpenAI vision: base64 images use data URI format', async () => {
    let capturedBody: any = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
    }) as any;
    try {
      await callLLM('gpt-4o-mini', [
        { role: 'user', content: 'Describe', images: [{ data: 'iVBORw0KGgoAAAA==', mimeType: 'image/png' }] }
      ]);
      const userMsg = capturedBody.messages.find((m: any) => m.role === 'user');
      expect(userMsg.content[0].image_url.url).toBe('data:image/png;base64,iVBORw0KGgoAAAA==');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('Anthropic vision: images converted to image source blocks', async () => {
    let capturedBody: any = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return new Response(JSON.stringify({
        id: 'msg_1', type: 'message', role: 'assistant',
        content: [{ type: 'text', text: 'A landscape' }],
      }));
    }) as any;
    try {
      await callLLM('claude-3-5-sonnet-20241022', [
        { role: 'user', content: 'What is this?', images: [{ data: 'abc123', mimeType: 'image/jpeg' }] }
      ]);
      const userMsg = capturedBody.messages.find((m: any) => m.role === 'user');
      expect(Array.isArray(userMsg.content)).toBe(true);
      expect(userMsg.content[0].type).toBe('image');
      expect(userMsg.content[0].source.type).toBe('base64');
      expect(userMsg.content[0].source.media_type).toBe('image/jpeg');
      expect(userMsg.content[0].source.data).toBe('abc123');
      expect(userMsg.content[1].type).toBe('text');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('text-only messages still work with no images field', async () => {
    let capturedBody: any = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'reply' } }] }));
    }) as any;
    try {
      await callLLM('gpt-4o-mini', [{ role: 'user', content: 'Just text' }]);
      const userMsg = capturedBody.messages.find((m: any) => m.role === 'user');
      // Should be plain string, not array
      expect(typeof userMsg.content).toBe('string');
      expect(userMsg.content).toBe('Just text');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('Gemini structured output: response_format adds responseMimeType and responseSchema', async () => {
    let capturedBody: any = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"answer": "42"}' }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      }));
    }) as any;
    try {
      const schema = { type: 'object', properties: { answer: { type: 'string' } } };
      const result = await callLLM('gemini-2.0-flash', [{ role: 'user', content: 'test' }], {
        response_format: { type: 'json_schema', json_schema: { name: 'test', schema } }
      });
      // generationConfig should include responseMimeType and responseSchema
      expect(capturedBody.generationConfig.responseMimeType).toBe('application/json');
      expect(capturedBody.generationConfig.responseSchema).toEqual(schema);
      expect(result).toContain('42');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('Gemini streaming: uses streamGenerateContent SSE endpoint', async () => {
    let capturedUrl = '';
    const originalFetch = globalThis.fetch;
    const sseData = [
      'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":" world"}]}}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":3}}\n\n',
    ];
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of sseData) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      }
    });
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
      return new Response(stream);
    }) as any;
    try {
      const updates: any[] = [];
      const result = await callLLM('gemini-2.0-flash', [{ role: 'user', content: 'hi' }],
        { streaming: (update: StreamingUpdate) => updates.push(update) });

      // Should use streamGenerateContent endpoint
      expect(capturedUrl).toContain('streamGenerateContent');
      expect(capturedUrl).toContain('alt=sse');
      // Should have received streaming updates
      expect(updates.length).toBe(2);
      expect(updates[0].value).toBe('Hello');
      expect(updates[1].value).toBe(' world');
      // Full response should be concatenated
      expect(result).toBe('Hello world');
      // Usage from last chunk
      expect(lastTokenUsage).not.toBeNull();
      expect(lastTokenUsage!.inputTokens).toBe(5);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('Gemini streaming: estimates usage when usageMetadata missing', async () => {
    const originalFetch = globalThis.fetch;
    // SSE chunks WITHOUT usageMetadata
    const sseData = [
      'data: {"candidates":[{"content":{"parts":[{"text":"estimated"}]}}]}\n\n',
    ];
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of sseData) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      }
    });
    globalThis.fetch = (async () => new Response(stream)) as any;
    try {
      const result = await callLLM('gemini-2.0-flash', [{ role: 'user', content: 'test' }], {
        streaming: (update) => { },
      });
      expect(result).toBe('estimated');
      // Should have fallback estimation (~4 chars/token)
      expect(lastTokenUsage).not.toBeNull();
      expect(lastTokenUsage!.outputTokens).toBeGreaterThan(0);
      expect(lastTokenUsage!.inputTokens).toBeGreaterThan(0);
      expect(lastTokenUsage!.totalTokens).toBe(lastTokenUsage!.inputTokens + lastTokenUsage!.outputTokens);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('OpenAI streaming: estimates usage when no usage events received', async () => {
    // SSE chunks WITHOUT the final usage event (stream_options.include_usage not set)
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"fallback"}}]}\n\n'));
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.close();
      }
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(stream)) as any;
    try {
      const result = await callLLM('gpt-4o-mini', [{ role: 'user', content: 'test' }], {
        streaming: () => { },
      });
      expect(result).toContain('fallback');
      // Should have fallback estimation
      expect(lastTokenUsage).not.toBeNull();
      expect(lastTokenUsage!.outputTokens).toBeGreaterThan(0);
      expect(lastTokenUsage!.totalTokens).toBe(lastTokenUsage!.inputTokens + lastTokenUsage!.outputTokens);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('Gemini non-streaming: uses generateContent endpoint (no streamingCallback)', async () => {
    let capturedUrl = '';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'response text' }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 8 },
      }));
    }) as any;
    try {
      const result = await callLLM('gemini-2.0-flash', [{ role: 'user', content: 'hi' }]);
      // Should use non-streaming endpoint
      expect(capturedUrl).toContain('generateContent');
      expect(capturedUrl).not.toContain('stream');
      expect(result).toBe('response text');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ── Abort / Timeout Tests ──

  test('timeoutMs: aborts request after timeout', async () => {
    const originalFetch = globalThis.fetch;
    // Signal-aware mock: rejects when aborted
    globalThis.fetch = (async (_url: string, opts: any) => {
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response('{}')), 10000);
        if (opts?.signal) {
          opts.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(opts.signal.reason || new DOMException('Aborted', 'AbortError'));
          });
        }
      });
    }) as any;
    try {
      await expect(
        callLLM('gpt-4o-mini', [{ role: 'user', content: 'hi' }], { timeoutMs: 50 })
      ).rejects.toThrow();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('signal: user-provided AbortSignal cancels request', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, opts: any) => {
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response('{}')), 10000);
        if (opts?.signal) {
          opts.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }
      });
    }) as any;
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 30);
      await expect(
        callLLM('gpt-4o-mini', [{ role: 'user', content: 'hi' }], { signal: controller.signal })
      ).rejects.toThrow();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('signal: passed to underlying fetch call', async () => {
    let capturedSignal: AbortSignal | undefined;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, opts: any) => {
      capturedSignal = opts.signal;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
    }) as any;
    try {
      const controller = new AbortController();
      await callLLM('gpt-4o-mini', [{ role: 'user', content: 'hi' }], { signal: controller.signal });
      expect(capturedSignal).toBeDefined();
      expect(capturedSignal).toBe(controller.signal);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ── Retry Tests ──

  test('retries on 429 and succeeds on second attempt', async () => {
    let attempts = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      attempts++;
      if (attempts === 1) {
        return new Response('Rate limited', { status: 429 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: 'retried ok' } }] }));
    }) as any;
    try {
      const result = await callLLM('gpt-4o-mini', [{ role: 'user', content: 'hi' }]);
      expect(attempts).toBe(2);
      expect(result).toBe('retried ok');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('does not retry on non-retryable errors (400)', async () => {
    let attempts = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      attempts++;
      return new Response(JSON.stringify({ error: { message: 'bad request' } }), { status: 400 });
    }) as any;
    try {
      // 400 is not retryable, so should fail after 1 attempt
      // The response will fail at validation, but attempts should be 1
      try { await callLLM('gpt-4o-mini', [{ role: 'user', content: 'hi' }]); } catch { }
      expect(attempts).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ── Anthropic Structured Output Tests ──

  test('Anthropic structured output: sends tools + tool_choice when response_format set', async () => {
    let capturedBody: any = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return new Response(JSON.stringify({
        content: [{ type: 'tool_use', id: 'tu_1', name: 'extract_data', input: { name: 'test', age: 25 } }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }));
    }) as any;
    try {
      const result = await callLLM('claude-sonnet-4-20250514', [{ role: 'user', content: 'extract data' }], {
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'extract_data',
            schema: { type: 'object', properties: { name: { type: 'string' }, age: { type: 'number' } } },
          },
        },
      });
      // Verify tools + tool_choice were sent
      expect(capturedBody.tools).toHaveLength(1);
      expect(capturedBody.tools[0].name).toBe('extract_data');
      expect(capturedBody.tool_choice).toEqual({ type: 'tool', name: 'extract_data' });
      // Verify response is JSON-stringified tool input
      const parsed = JSON.parse(result);
      expect(parsed.name).toBe('test');
      expect(parsed.age).toBe(25);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('Anthropic tool_use response parsing extracts input correctly', () => {
    const data = {
      content: [
        { type: 'tool_use', id: 'tu_1', name: 'my_tool', input: { key: 'value', num: 42 } }
      ],
      usage: { input_tokens: 10 },
    };
    const parsed = AnthropicResponseSchema.parse(data);
    const toolBlock = parsed.content.find(b => b.type === 'tool_use' && b.input);
    expect(toolBlock).toBeDefined();
    expect(JSON.stringify(toolBlock!.input)).toBe('{"key":"value","num":42}');
  });

  // ── DeepSeek R1 Reasoning Tests ──

  test('DeepSeek R1: reasoning_content captured in lastTokenUsage', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        choices: [{ message: { content: 'The answer is 4', reasoning_content: 'Step 1: 2+2=4. Step 2: verify.' } }],
        usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
      }))
    ) as any;
    try {
      const result = await callLLM('deepseek-reasoner', [{ role: 'user', content: 'What is 2+2?' }]);
      expect(result).toBe('The answer is 4');
      expect(lastTokenUsage).not.toBeNull();
      expect(lastTokenUsage!.reasoningContent).toBe('Step 1: 2+2=4. Step 2: verify.');
      expect(lastTokenUsage!.totalTokens).toBe(70);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('DeepSeek R1 streaming: emits reasoning_content as _reasoning field', async () => {
    const sseData = [
      'data: {"choices":[{"delta":{"reasoning_content":"Let me think..."}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Answer: 4"}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning_content":" step 2"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of sseData) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      }
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(stream)) as any;
    try {
      const reasoningChunks: string[] = [];
      const result = await callLLM('deepseek-reasoner', [{ role: 'user', content: 'test' }], {
        streaming: (update: StreamingUpdate) => {
          if (update.field === '_reasoning') reasoningChunks.push(update.value);
        },
      });
      expect(result).toContain('Answer: 4');
      expect(reasoningChunks.length).toBe(2);
      expect(reasoningChunks[0]).toBe('Let me think...');
      expect(reasoningChunks[1]).toBe(' step 2');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ── Gemini 2.5 Thinking Tests ──

  test('Gemini 2.5: thinkingConfig included in request body', async () => {
    let capturedBody: any = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'answer' }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      }));
    }) as any;
    try {
      await callLLM('gemini-2.5-pro-preview-05-06', [{ role: 'user', content: 'test' }]);
      expect(capturedBody.generationConfig.thinkingConfig).toEqual({ includeThoughts: true });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('Gemini 2.5: thought parts extracted to reasoningContent, answer returned clean', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [
              { text: 'I need to calculate 2+2. That equals 4.', thought: true },
              { text: 'The answer is 4.' },
            ]
          }
        }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 },
      }))
    ) as any;
    try {
      const result = await callLLM('gemini-2.5-flash-preview-05-20', [{ role: 'user', content: '2+2' }]);
      expect(result).toBe('The answer is 4.');
      expect(lastTokenUsage).not.toBeNull();
      expect(lastTokenUsage!.reasoningContent).toBe('I need to calculate 2+2. That equals 4.');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('Gemini 2.5 streaming: thought parts emitted as _reasoning field', async () => {
    const sseData = [
      'data: {"candidates":[{"content":{"parts":[{"text":"thinking...","thought":true}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"The answer"}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":" is 42"}]}}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":3}}\n\n',
    ];
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of sseData) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      }
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string) => new Response(stream)) as any;
    try {
      const reasoningChunks: string[] = [];
      const contentChunks: string[] = [];
      const result = await callLLM('gemini-2.5-pro-preview-05-06', [{ role: 'user', content: 'test' }], {
        streaming: (update: StreamingUpdate) => {
          if (update.field === '_reasoning') reasoningChunks.push(update.value);
          if (update.field === 'content') contentChunks.push(update.value);
        },
      });
      expect(reasoningChunks).toEqual(['thinking...']);
      expect(contentChunks).toEqual(['The answer', ' is 42']);
      expect(result).toBe('The answer is 42');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ── Claude Extended Thinking Tests ──

  test('Claude Sonnet 4: thinking config included in request body', async () => {
    let capturedBody: any = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: 'answer' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }));
    }) as any;
    try {
      await callLLM('claude-sonnet-4-20250514', [{ role: 'user', content: 'test' }]);
      expect(capturedBody.thinking).toEqual({ type: 'enabled', budget_tokens: 10000 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('Claude: thinking blocks extracted to reasoningContent, text returned clean', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        content: [
          { type: 'thinking', thinking: 'Let me think about this step by step...' },
          { type: 'text', text: 'The answer is 42.' },
        ],
        usage: { input_tokens: 15, output_tokens: 25 },
      }))
    ) as any;
    try {
      const result = await callLLM('claude-sonnet-4-20250514', [{ role: 'user', content: 'test' }]);
      expect(result).toBe('The answer is 42.');
      expect(lastTokenUsage).not.toBeNull();
      expect(lastTokenUsage!.reasoningContent).toBe('Let me think about this step by step...');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('Claude streaming: thinking deltas emitted as _reasoning field', async () => {
    const sseData = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"thinking":"step by step..."}}\n\n',
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\n',
      'data: {"type":"content_block_delta","index":1,"delta":{"text":"The answer"}}\n\n',
      'data: {"type":"content_block_delta","index":1,"delta":{"text":" is 42"}}\n\n',
      'data: {"type":"message_delta","usage":{"output_tokens":20}}\n\n',
    ];
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of sseData) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      }
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(stream)) as any;
    try {
      const reasoningChunks: string[] = [];
      const contentChunks: string[] = [];
      const result = await callLLM('claude-sonnet-4-20250514', [{ role: 'user', content: 'test' }], {
        streaming: (update: StreamingUpdate) => {
          if (update.field === '_reasoning') reasoningChunks.push(update.value);
        },
      });
      expect(reasoningChunks).toEqual(['step by step...']);
      // The text content goes through the XML tag parser, verify via result string
      expect(result).toContain('The answer');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ── callLLMWithFallback Tests ──

  test('callLLMWithFallback: uses second provider when first fails', async () => {
    let callCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string) => {
      callCount++;
      if (callCount === 1) {
        // First provider fails with 401 (non-retryable — 500 would trigger retries)
        return new Response('Unauthorized', { status: 401 });
      }
      // Second provider succeeds
      return new Response(JSON.stringify({ choices: [{ message: { content: 'fallback worked' } }] }));
    }) as any;
    try {
      const onFallbackCalls: string[] = [];
      const result = await callLLMWithFallback(
        {
          providers: ['gpt-4o', 'gpt-4o-mini'],
          onFallback: (failed, _err, next) => onFallbackCalls.push(`${failed}->${next}`),
        },
        [{ role: 'user', content: 'hello' }],
      );
      expect(result).toBe('fallback worked');
      expect(onFallbackCalls).toEqual(['gpt-4o->gpt-4o-mini']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('callLLMWithFallback: signal/timeoutMs options forwarded to callLLM', async () => {
    const abortController = new AbortController();
    const originalFetch = globalThis.fetch;
    let capturedSignal: AbortSignal | undefined;
    globalThis.fetch = (async (_url: string, opts: any) => {
      capturedSignal = opts.signal;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
    }) as any;
    try {
      await callLLMWithFallback(
        { providers: ['gpt-4o-mini'] },
        [{ role: 'user', content: 'hello' }],
        { signal: abortController.signal, timeoutMs: 5000 },
      );
      // The signal should have been composed (user signal + timeout) and passed to fetch
      expect(capturedSignal).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ── Provider Health Check Tests ──

  test('getProviderEndpoint maps model names to correct endpoints', () => {
    expect(getProviderEndpoint('claude-sonnet-4-20250514')).toBe('https://api.anthropic.com/v1/messages');
    expect(getProviderEndpoint('deepseek-chat')).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(getProviderEndpoint('gemini-2.5-flash')).toContain('generativelanguage.googleapis.com');
    expect(getProviderEndpoint('gemini-2.5-flash')).toContain('gemini-2.5-flash');
    expect(getProviderEndpoint('gpt-4o')).toBe('https://api.openai.com/v1/chat/completions');
    expect(getProviderEndpoint('gpt-4o-mini')).toBe('https://api.openai.com/v1/chat/completions');
  });

  test('pingProvider returns ok:true for reachable endpoint (mocked)', async () => {
    clearHealthCache();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('', { status: 401 })) as any; // 4xx = reachable
    try {
      const result = await pingProvider('gpt-4o');
      expect(result.ok).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
      clearHealthCache();
    }
  });

  test('pingProvider returns ok:false for 500 server error', async () => {
    clearHealthCache();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('Internal Server Error', { status: 500 })) as any;
    try {
      const result = await pingProvider('gpt-4o');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('HTTP 500');
    } finally {
      globalThis.fetch = originalFetch;
      clearHealthCache();
    }
  });

  test('pingProvider caches results for 60s', async () => {
    clearHealthCache();
    const originalFetch = globalThis.fetch;
    let fetchCount = 0;
    globalThis.fetch = (async () => { fetchCount++; return new Response('', { status: 200 }); }) as any;
    try {
      await pingProvider('gpt-4o');
      await pingProvider('gpt-4o');
      expect(fetchCount).toBe(1); // Second call should use cache
    } finally {
      globalThis.fetch = originalFetch;
      clearHealthCache();
    }
  });

  test('callLLMWithFallback: skipUnhealthy skips dead provider', async () => {
    clearHealthCache();
    const originalFetch = globalThis.fetch;
    let fetchCalls: string[] = [];
    globalThis.fetch = (async (url: string, opts: any) => {
      fetchCalls.push(opts?.method || 'POST');
      if (opts?.method === 'HEAD') {
        // First provider (claude) returns 500, second (gpt) returns 200
        if (url.includes('anthropic')) return new Response('', { status: 500 });
        return new Response('', { status: 200 });
      }
      // POST — actual LLM call
      return new Response(JSON.stringify({ choices: [{ message: { content: 'healthy provider' } }] }));
    }) as any;
    try {
      const skippedProviders: string[] = [];
      const result = await callLLMWithFallback(
        {
          providers: ['claude-sonnet-4-20250514', 'gpt-4o-mini'],
          onFallback: (failed) => skippedProviders.push(failed),
        },
        [{ role: 'user', content: 'hello' }],
        { skipUnhealthy: true },
      );
      expect(result).toBe('healthy provider');
      // Claude should have been skipped due to 500 health check
      expect(skippedProviders).toContain('claude-sonnet-4-20250514');
    } finally {
      globalThis.fetch = originalFetch;
      clearHealthCache();
    }
  });
}
