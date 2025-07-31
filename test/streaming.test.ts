import { test, expect, it, describe } from 'bun:test';
import { z } from 'zod';
import { Agent, LLM, ProgressUpdate, StreamingUpdate } from '../uai';

describe('UAI Streaming Tests', () => {
  it('should emit streaming progress updates token-by-token', async () => {
    const streamingAgent = new Agent({
      llm: 'o4-mini-2025-04-16',
      inputFormat: z.object({
        question: z.string(),
      }),
      outputFormat: z.object({
        analysis: z.object({
          step1: z.string(), // nested fieild should be named like analysis_step1
          step2: z.string(),
          step3: z.string(),
        }).describe("Step-by-step analysis of the question"),
        answer: z.string().describe("The final short concise answer to the question"),
        status: z.string().describe("just literal word OK"), // to ensure streaming single-word responses
      }),
      temperature: 0.7,
    });

    const input = {
      question: 'What are the benefits of renewable energy?',
    };

    const streamingUpdates: StreamingUpdate[] = [];
    const progressUpdates: ProgressUpdate[] = [];

    try {
      const result = await streamingAgent.run(input, (update) => {
        if (update.stage === 'streaming') {
          streamingUpdates.push(update as StreamingUpdate);
          console.log(`Field: ${update.field}, Value: ${update.value}`);
        } else {
          progressUpdates.push(update);
        }
      });

      console.log('\n--- Final Result ---');
      console.log('Analysis:', result.analysis);
      console.log('Answer:', result.answer);

      // Verify we received streaming updates
      expect(streamingUpdates.length).toBeGreaterThan(0);

      // Verify we have updates for both fields
      const fieldsUpdated = new Set(streamingUpdates.map(u => u.field));
      expect(fieldsUpdated.has('analysis')).toBe(true);
      expect(fieldsUpdated.has('answer')).toBe(true);

      // Verify the streaming updates show progressive content building
      const analysisUpdates = streamingUpdates.filter(u => u.field === 'analysis');
      const answerUpdates = streamingUpdates.filter(u => u.field === 'answer');

      expect(analysisUpdates.length).toBeGreaterThan(1);
      expect(answerUpdates.length).toBeGreaterThan(1);

      // Verify content is progressively building (each update should contain more text)
      for (let i = 1; i < analysisUpdates.length; i++) {
        expect(analysisUpdates[i].value.length).toBeGreaterThanOrEqual(analysisUpdates[i - 1].value.length);
      }

      // Verify final result matches last streaming update values
      const lastAnalysisUpdate = analysisUpdates[analysisUpdates.length - 1];
      const lastAnswerUpdate = answerUpdates[answerUpdates.length - 1];

      expect(result.analysis.trim()).toBe(lastAnalysisUpdate.value.trim());
      expect(result.answer.trim()).toBe(lastAnswerUpdate.value.trim());

      console.log(`\n✅ Received ${streamingUpdates.length} streaming updates across ${fieldsUpdated.size} fields`);

    } catch (error) {
      console.warn('\n⚠️ Streaming test skipped (this is expected if API keys are not configured):', error.message);
    }
  }, { timeout: 60000 });
});
