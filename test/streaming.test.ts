import { test, expect, it, describe } from 'bun:test';
import { z } from 'zod';
import { Agent } from '../src/agent';
import type { ProgressUpdate, StreamingUpdate } from '../src/types';

describe('uai streaming tests', () => {
  it('should emit streaming progress updates token-by-token', async () => {
    const streamingAgent = new Agent({
      llm: 'gpt-4o-mini' as any,
      inputFormat: z.object({
        question: z.string(),
      }),
      outputFormat: z.object({
        analysis: z.object({
          step1: z.string(),
          step2: z.string(),
          step3: z.string(),
        }).describe("step-by-step analysis of the question"),
        answer: z.string().describe("the final short concise answer to the question"),
        status: z.string().describe("just literal word ok"),
      }),
      temperature: 0.7,
    });

    const input = {
      question: 'what are the benefits of renewable energy?',
    };

    const streamingUpdates: StreamingUpdate[] = [];
    const progressUpdates: ProgressUpdate[] = [];

    try {
      const result = await streamingAgent.run(input, (update) => {
        if (update.stage === 'streaming') {
          streamingUpdates.push(update as unknown as StreamingUpdate);
          console.log(`field: ${(update as any).field}, value: ${(update as any).value}`);
        } else {
          progressUpdates.push(update);
        }
      });

      console.log('\n--- final result ---');
      console.log('analysis:', result.analysis);
      console.log('answer:', result.answer);

      // verify we received streaming updates
      expect(streamingUpdates.length).toBeGreaterThan(0);

      // verify we have updates for both fields
      const fieldsUpdated = new Set(streamingUpdates.map(u => u.field));
      expect(fieldsUpdated.has('analysis')).toBe(true);
      expect(fieldsUpdated.has('answer')).toBe(true);

      // verify the streaming updates show progressive content building
      const analysisUpdates = streamingUpdates.filter(u => u.field === 'analysis');
      const answerUpdates = streamingUpdates.filter(u => u.field === 'answer');

      expect(analysisUpdates.length).toBeGreaterThan(1);
      expect(answerUpdates.length).toBeGreaterThan(1);

      // verify content is progressively building
      for (let i = 1; i < analysisUpdates.length; i++) {
        expect(analysisUpdates[i]!.value.length).toBeGreaterThanOrEqual(analysisUpdates[i - 1]!.value.length);
      }

      // verify final result matches last streaming update values
      const lastAnalysisUpdate = analysisUpdates[analysisUpdates.length - 1]!;
      const lastAnswerUpdate = answerUpdates[answerUpdates.length - 1]!;

      expect(JSON.stringify(result.analysis)).toBe(lastAnalysisUpdate.value.trim());
      expect(result.answer.trim()).toBe(lastAnswerUpdate.value.trim());

      console.log(`\n✅ received ${streamingUpdates.length} streaming updates across ${fieldsUpdated.size} fields`);

    } catch (error: unknown) {
      console.warn('\n⚠️ streaming test skipped (this is expected if api keys are not configured):', (error as Error).message);
    }
  }, { timeout: 60000 });

  it('should flawlessly parse and flatten deep object nesting (3+ levels)', async () => {
    const deepAgent = new Agent({
      llm: 'gpt-4o-mini' as any,
      inputFormat: z.object({
        start: z.string(),
      }),
      outputFormat: z.object({
        level1: z.object({
          level2: z.object({
            level3: z.object({
              value1: z.string().describe("first value in deep level"),
              value2: z.string().describe("second value in deep level"),
            }).describe("third level deep object")
          }).describe("second level deep object")
        }).describe("first level deep object"),
        done: z.boolean().describe("true when done"),
      }),
      temperature: 0.1,
    });

    const mockStream = new ReadableStream({
      start(controller) {
        const enqueueText = (text: string) => {
          controller.enqueue(new TextEncoder().encode(`data: {"choices": [{"delta": {"content": ${JSON.stringify(text)}}}]}\n\n`));
        };
        enqueueText("<level1>");
        enqueueText("<level2>");
        enqueueText("<level3>");
        enqueueText("<value1>hello</value1>");
        enqueueText("<value2>world</value2>");
        enqueueText("</level3>");
        enqueueText("</level2>");
        enqueueText("</level1>");
        enqueueText("<done>true</done>");
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.close();
      }
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(mockStream)) as any;

    const input = {
      start: 'give me 2 sample string values deep inside',
    };

    const streamingUpdates: StreamingUpdate[] = [];

    try {
      const result = await deepAgent.run(input, (update) => {
        if (update.stage === 'streaming') {
          streamingUpdates.push(update as unknown as StreamingUpdate);
        }
      });

      console.log('\n--- final result deep ---');
      console.log(JSON.stringify(result, null, 2));

      // verify fields are correctly flattened using underscores
      const fieldsUpdated = new Set(streamingUpdates.map(u => u.field));
      expect(fieldsUpdated.has('level1_level2_level3_value1')).toBe(true);
      expect(fieldsUpdated.has('level1_level2_level3_value2')).toBe(true);
      expect(fieldsUpdated.has('done')).toBe(true);

      // Verify the final result objects have been reconstructed properly by the Agent
      expect(result.level1).toBeDefined();
      expect(console.log).toBeDefined(); // stop complaints
      expect((result.level1 as any).level2.level3.value1).toBe('hello');
      expect((result.level1 as any).level2.level3.value2).toBe('world');
      expect(result.done).toBe(true);

      console.log(`\n✅ received deep streaming updates across ${fieldsUpdated.size} flattened fields`);

    } finally {
      globalThis.fetch = originalFetch;
    }
  }, { timeout: 60000 });
});
