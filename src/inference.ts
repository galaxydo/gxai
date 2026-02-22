// src/inference.ts
import { expect, test } from 'bun:test';
import { LLMType, ProgressUpdate, StreamingUpdate } from './types';
import { ProgressCallback, StreamingCallback } from './types';

export async function callLLM(
  llm: LLMType,
  messages: Array<{ role: string; content: string }>,
  options: { temperature?: number; maxTokens?: number } = {},
  measureFn: any,
  streamingCallback?: StreamingCallback,
  progressCallback?: ProgressCallback,
  fetchWithPayment: (url: string, options: RequestInit, measure: any, description: string, progressCallback?: ProgressCallback) => Promise<Response>
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
    // Gemini REST API — direct HTTP, no SDK
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY is required");
    headers["x-goog-api-key"] = apiKey;
    url = `https://generativelanguage.googleapis.com/v1beta/models/${llm}:generateContent`;

    // Convert messages to Gemini's contents/parts format
    // Gemini requires strictly alternating user/model turns and non-empty parts
    const systemInstruction = messages.find(m => m.role === "system")?.content;
    const nonSystemMsgs = messages
      .filter(m => m.role !== "system" && m.content?.trim());

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
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
      },
      ...(systemInstruction && { systemInstruction: { parts: [{ text: systemInstruction }] } }),
    };

    // Gemini has a different response format — handle inline with retry for rate limits
    const requestBodyStr2 = JSON.stringify(body);
    const geminiResponse = await measureFn(
      async (measure: any) => {
        const maxRetries = 3;
        const retryDelays = [5000, 15000, 30000];

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          const res = await fetchWithPayment(
            url, { method: "POST", headers, body: requestBodyStr2 },
            measure,
            `HTTP ${llm} API call (attempt ${attempt + 1})`,
            progressCallback
          );

          if (res.status === 429 && attempt < maxRetries) {
            const delay = retryDelays[attempt] ?? 30000;
            progressCallback?.({
              stage: "response_generation",
              message: `Rate limited (429), retrying in ${delay / 1000}s...`,
            });
            await new Promise(r => setTimeout(r, delay));
            continue;
          }

          const data = await res.json() as any;
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) {
            throw new Error(`Gemini API call failed: ${JSON.stringify(data).substring(0, 300)}`);
          }
          return text;
        }
        throw new Error(`Gemini API: exhausted ${maxRetries} retries due to rate limits`);
      },
      `LLM call to ${llm}`
    );
    return geminiResponse;
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

  if (!streamingCallback) {
    const response = await measureFn(
      async (measure: any) => {
        const res = await fetchWithPayment(
          url,
          {
            method: "POST",
            headers,
            body: requestBodyStr,
          },
          measure,
          `HTTP ${llm} API call - Body: ${requestBodyStr.substring(0, 200)}...`,
          progressCallback
        );
        const data = await res.json();
        const content = llm.includes("claude") ? data.content?.[0]?.text : data.choices?.[0]?.message?.content;
        if (!content) {
          throw new Error(
            `LLM API call to ${llm} failed. Unexpected response format: ${JSON.stringify(data).substring(0, 200)}...`
          );
        }
        return content;
      },
      `LLM call to ${llm}`
    );
    return response;
  } else {
    const response = await measureFn(
      async (measure: any) => {
        const res = await fetchWithPayment(
          url,
          {
            method: "POST",
            headers,
            body: requestBodyStr,
          },
          measure,
          `HTTP ${llm} streaming API call - Body: ${requestBodyStr.substring(0, 200)}...`,
          progressCallback
        );
        return res;
      },
      `LLM streaming call to ${llm}`
    );

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
      if (!line.startsWith("data: ") || line.includes("[DONE]")) {
        return "";
      }
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
          if (content) {
            processChunk(content);
          }
        }
      }
    } finally {
      reader.releaseLock();
      if (buffer) {
        const content = parseSseLine(buffer);
        if (content) {
          processChunk(content);
        }
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
  const { measure } = await import('@ments/utils');

  test('callLLM non-streaming mock', async () => {
    const mockFetchWithPayment = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'test response' } }] }));
    const mockMeasure = async (fn: any, desc: string) => await fn(mockMeasure);
    const result = await callLLM(
      'gpt-4o-mini',
      [{ role: 'user', content: 'hello' }],
      {},
      mockMeasure,
      undefined,
      undefined,
      mockFetchWithPayment
    );
    expect(result).toBe('test response');
  });

  test('callLLM with streaming mock', async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices": [{"delta": {"content": "test "}}]}\n\n'));
        controller.enqueue(new TextEncoder().encode('data: {"choices": [{"delta": {"content": "stream"}}]}\n\n'));
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.close();
      }
    });
    const mockResponse = new Response(mockStream);
    const mockFetchWithPayment = async () => mockResponse;
    const mockMeasure = async (fn: any, desc: string) => await fn(mockMeasure);
    const streamingUpdates: StreamingUpdate[] = [];
    const mockStreamingCallback = (update: StreamingUpdate) => streamingUpdates.push(update);
    const result = await callLLM(
      'gpt-4o-mini',
      [{ role: 'user', content: 'hello' }],
      {},
      mockMeasure,
      mockStreamingCallback,
      undefined,
      mockFetchWithPayment
    );
    expect(result).toContain('test stream');
    expect(streamingUpdates.length).toBeGreaterThan(0);
  });
}
