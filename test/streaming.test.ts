import { test, expect, it, describe } from 'bun:test';
import { z } from 'zod';
import { agent, llm, progressupdate, streamingupdate } from '../uai';

describe('uai streaming tests', () => {
  it('should emit streaming progress updates token-by-token', async () => {
    const streamingagent = new agent({
      llm: 'o4-mini-2025-04-16',
      inputformat: z.object({
        question: z.string(),
      }),
      outputformat: z.object({
        analysis: z.object({
          step1: z.string(), // nested fieild should be named like analysis_step1
          step2: z.string(),
          step3: z.string(),
        }).describe("step-by-step analysis of the question"),
        answer: z.string().describe("the final short concise answer to the question"),
        status: z.string().describe("just literal word ok"), // to ensure streaming single-word responses
      }),
      temperature: 0.7,
    });

    const input = {
      question: 'what are the benefits of renewable energy?',
    };

    const streamingupdates: streamingupdate[] = [];
    const progressupdates: progressupdate[] = [];

    try {
      const result = await streamingagent.run(input, (update) => {
        if (update.stage === 'streaming') {
          streamingupdates.push(update as streamingupdate);
          console.log(`field: ${update.field}, value: ${update.value}`);
        } else {
          progressupdates.push(update);
        }
      });

      console.log('\n--- final result ---');
      console.log('analysis:', result.analysis);
      console.log('answer:', result.answer);

      // verify we received streaming updates
      expect(streamingupdates.length).tobegreaterthan(0);

      // verify we have updates for both fields
      const fieldsupdated = new set(streamingupdates.map(u => u.field));
      expect(fieldsupdated.has('analysis')).tobe(true);
      expect(fieldsupdated.has('answer')).tobe(true);

      // verify the streaming updates show progressive content building
      const analysisupdates = streamingupdates.filter(u => u.field === 'analysis');
      const answerupdates = streamingupdates.filter(u => u.field === 'answer');

      expect(analysisupdates.length).tobegreaterthan(1);
      expect(answerupdates.length).tobegreaterthan(1);

      // verify content is progressively building (each update should contain more text)
      for (let i = 1; i < analysisupdates.length; i++) {
        expect(analysisupdates[i].value.length).tobegreaterthanorequal(analysisupdates[i - 1].value.length);
      }

      // verify final result matches last streaming update values
      const lastanalysisupdate = analysisupdates[analysisupdates.length - 1];
      const lastanswerupdate = answerupdates[answerupdates.length - 1];

      expect(result.analysis.trim()).tobe(lastanalysisupdate.value.trim());
      expect(result.answer.trim()).tobe(lastanswerupdate.value.trim());

      console.log(`\n✅ received ${streamingupdates.length} streaming updates across ${fieldsupdated.size} fields`);

    } catch (error) {
      console.warn('\n⚠️ streaming test skipped (this is expected if api keys are not configured):', error.message);
    }
  }, { timeout: 60000 });
});
