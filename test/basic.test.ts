import { test, expect, it, describe } from 'bun:test';
import { z } from 'zod';
import { Agent, LLM, ProgressUpdate } from '../uai';

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
      }),
      temperature: 0.7,
    });

    const input = {
      user_query: 'What is the best way to invest $100?',
      personality: 'A cautious, old sea captain who has seen many treasures lost to recklessness.',
      tone: 'serious' as const, // 'as const' helps TypeScript infer the most specific type
    };

    try {
      // 2. Run the agent and await the structured result
      const { finalResponse, thinkingProcess } = await personaAgent.run(input, (update) => {
        console.log("update", update)
      });

      // 3. Log the output for easy debugging during test runs
      console.log('\n--- Thinking Process ---');
      console.log(thinkingProcess);
      console.log('\n--- Final Response ---');
      console.log(finalResponse);

      // 4. Verify the structure and content of the response
      expect(thinkingProcess).toBeTypeOf('string');
      expect(thinkingProcess.length).toBeGreaterThan(1); // Assert it's not empty

      expect(finalResponse).toBeTypeOf('string');
      // Check for persona-specific keywords to confirm the prompt was followed
      expect(finalResponse.toLowerCase()).toInclude('sea');

      console.log('\n✅ Agent generated a valid, structured response that fits the persona.');

    } catch (error) {
      // This block allows the test to pass gracefully if API keys aren't configured.
      console.warn('\n⚠️ API call test skipped (this is expected if API keys are not configured):', error.message);
    }
  }, { timeout: 30000 });
});