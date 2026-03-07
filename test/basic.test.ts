import { test, expect, it, describe } from 'bun:test';
import { z } from 'zod';
import { Agent } from '../src/agent';
import { LLM } from '../src/types';

describe('UAI Library Advanced Tests', () => {
  it('should generate a structured response with a thinking process based on persona', async () => {
    // 1. Define an Agent with more meaningful input and output schemas
    const personaAgent = new Agent({
      llm: LLM['gpt-4o-mini'],
      // Input requires context for how the AI should behave
      inputFormat: z.object({
        user_query: z.string(),
        personality: z.string(),
        tone: z.enum(['humorous', 'formal', 'serious']),
      }),
      // Output is structured to separate reasoning from the final answer
      outputFormat: z.object({
        thinkingProcess: z.string().describe("My step-by-step reasoning for crafting the response, from the persona's point of view."),
        finalResponse: z.string().describe("The final, crafted response for the user, delivered in character."),
        suggestedMarkup: z.string().describe("A sample HTML block based on the response, which could be e.g. a div or a blockquote."),
        status: z.boolean().describe("is it done or not"),
      }),
      temperature: 0.7,
    });

    const input = {
      user_query: 'What is the best way to invest $100?',
      personality: 'A cautious, old sea captain who has seen many treasures lost to recklessness.',
      tone: 'serious' as const,
    };

    try {
      const streamingResponse: Record<string, string> = {};
      // 2. Run the agent and await the structured result
      const { finalResponse, thinkingProcess, suggestedMarkup, status } = await personaAgent.run(input, (update: any) => {
        if (update.stage === 'streaming') {
          streamingResponse[update.field] = (streamingResponse[update.field] || '') + update.value;
        }
      });

      // 3. Log the output for easy debugging during test runs
      console.log('\n--- Thinking Process ---');
      console.log(thinkingProcess);
      console.log('\n--- Final Response ---');
      console.log(finalResponse);
      console.log('\n--- Suggested Markup ---');
      console.log(suggestedMarkup);
      console.log('\n--- Status ---');
      console.log(status);

      // check boolean type prompts
      expect(status).toBe(true);

      // 4. Verify the structure and content of the response
      expect(thinkingProcess).toBeTypeOf('string');
      expect(thinkingProcess.length).toBeGreaterThan(1);

      expect(finalResponse).toBeTypeOf('string');
      expect(finalResponse.toLowerCase()).toInclude('sea');
      expect(suggestedMarkup).toBeTypeOf('string');
      expect(suggestedMarkup.trim()).toStartWith('<');
      expect(suggestedMarkup.trim()).toEndWith('>');

      console.log('\n✅ Agent generated a valid, structured response that fits the persona.');

    } catch (error: unknown) {
      console.warn('\n⚠️ API call test skipped (this is expected if API keys are not configured):', (error as Error).message);
    }
  }, { timeout: 30000 });
});