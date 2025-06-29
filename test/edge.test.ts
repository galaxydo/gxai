import { test, expect, it, describe } from 'bun:test';
import { z } from 'zod';
import { Agent, LLM, ProgressUpdate } from '../uai';

describe('UAI Library Tests', () => {
  it('should process complex input validation successfully', async () => {
    const complexAgent = new Agent({
      llm: LLM.gpt4o,
      inputFormat: z.object({
        userQuery: z.string().describe('The main question or request from the user'),
        context: z.object({
          sessionId: z.string().describe('Unique identifier for this conversation session'),
          previousInteraction: z.string().optional().describe('Summary of previous interaction if any'),
          userPreferences: z.object({
            responseStyle: z.enum(['formal', 'casual', 'technical']).describe('Preferred communication style'),
            detailLevel: z.enum(['brief', 'moderate', 'comprehensive']).describe('Desired level of detail in responses'),
          }),
        }),
        metadata: z.object({
          timestamp: z.string().describe('ISO timestamp of the request'),
          platform: z.string().describe('Platform or device used to make the request'),
          urgency: z.enum(['low', 'medium', 'high']).describe('Priority level of the request'),
        }),
      }),
      outputFormat: z.object({
        primaryResponse: z.string().describe('The main answer or response to the user query'),
        analysis: z.object({
          confidence: z.number().describe('Confidence level from 0 to 1 in the response accuracy'),
          reasoning: z.string().describe('Brief explanation of the reasoning process used'),
          complexity: z.enum(['simple', 'moderate', 'complex']).describe('Assessed complexity of the query'),
        }),
      }),
    });

    try {
      await complexAgent.run({
        userQuery: 'What are the best practices for sustainable software development?',
        context: {
          sessionId: 'session_12345',
          previousInteraction: 'User previously asked about green computing',
          userPreferences: {
            responseStyle: 'technical',
            detailLevel: 'comprehensive',
          },
        },
        metadata: {
          timestamp: '2024-12-25T10:30:00Z',
          platform: 'web_browser',
          urgency: 'medium',
        },
      });
      console.log('✅ Complex input validation and processing successful');
    } catch (error) {
      console.warn('⚠️ API call test skipped (possibly due to API keys):', error.message);
      if (!error.message.includes('API') && !error.message.includes('401') && !error.message.includes('403')) {
        throw error;
      }
    }
  });

  it('should throw error for arrays in output schema', () => {
    expect(() => {
      new Agent({
        llm: LLM.gpt4o,
        inputFormat: z.object({
          message: z.string(),
        }),
        outputFormat: z.object({
          responses: z.array(z.string()), // This should throw an error
        }),
      });
    }).toThrow('Arrays are not supported in output schema. Found array at path: responses. Use individual fields like responses_1, responses_2 instead.');

    console.log('✅ Array validation working correctly');
  });

  it('should throw error for nested arrays in output schema', () => {
    expect(() => {
      new Agent({
        llm: LLM.gpt4o,
        inputFormat: z.object({
          message: z.string(),
        }),
        outputFormat: z.object({
          data: z.object({
            items: z.array(z.string()), // Nested array should also throw
          }),
        }),
      });
    }).toThrow('Arrays are not supported in output schema. Found array at path: data.items. Use individual fields like items_1, items_2 instead.');

    console.log('✅ Nested array validation working correctly');
  });

  it('should validate input types correctly', async () => {
    const agent = new Agent({
      llm: LLM.gpt4o,
      inputFormat: z.object({
        message: z.string(),
        count: z.number(),
      }),
      outputFormat: z.object({
        response: z.string(),
      }),
    });

    try {
      await agent.run({
        message: 123 as any, // Wrong type
        count: 'not a number' as any, // Wrong type
      });
      expect(false).toBe(true); // Should not reach here
    } catch (error) {
      expect(error.name).toBe('ZodError');
      console.log('✅ Input type validation working correctly');
    }
  });

  it('should validate enum values correctly', async () => {
    const agent = new Agent({
      llm: LLM.gpt4o,
      inputFormat: z.object({
        message: z.string(),
        priority: z.enum(['low', 'medium', 'high']),
      }),
      outputFormat: z.object({
        response: z.string(),
      }),
    });

    try {
      await agent.run({
        message: 'test',
        priority: 'invalid_priority' as any, // Invalid enum value
      });
      expect(false).toBe(true); // Should not reach here
    } catch (error) {
      expect(error.name).toBe('ZodError');
      console.log('✅ Enum validation working correctly');
    }
  });

  it('should support all LLM model configurations', () => {
    const models = [LLM.gpt4o, LLM.gpt4, LLM.claude, LLM.deepseek];
    
    for (const model of models) {
      const agent = new Agent({
        llm: model,
        inputFormat: z.object({
          query: z.string(),
        }),
        outputFormat: z.object({
          result: z.string(),
          metadata: z.object({
            model: z.string(),
            confidence: z.number(),
          }),
        }),
      });

      expect(agent).toBeDefined();
      console.log(`✅ ${model} configuration valid`);
    }
  });

  it('should handle optional fields correctly', async () => {
    const agent = new Agent({
      llm: LLM.gpt4o,
      inputFormat: z.object({
        required: z.string(),
        optional: z.string().optional(),
      }),
      outputFormat: z.object({
        answer: z.string(),
        extra: z.string().optional(),
      }),
    });

    try {
      await agent.run({
        required: 'test value',
        // optional field omitted
      });
      console.log('✅ Optional fields handled correctly');
    } catch (error) {
      console.warn('⚠️ Optional fields test skipped due to API limitations');
      if (!error.message.includes('API') && !error.message.includes('401') && !error.message.includes('403')) {
        throw error;
      }
    }
  });

  it('should handle nullable fields correctly', async () => {
    const agent = new Agent({
      llm: LLM.gpt4o,
      inputFormat: z.object({
        required: z.string(),
        nullable: z.string().nullable(),
      }),
      outputFormat: z.object({
        answer: z.string(),
        extra: z.string().nullable(),
      }),
    });

    try {
      await agent.run({
        required: 'test value',
        nullable: null,
      });
      console.log('✅ Nullable fields handled correctly');
    } catch (error) {
      console.warn('⚠️ Nullable fields test skipped due to API limitations');
      if (!error.message.includes('API') && !error.message.includes('401') && !error.message.includes('403')) {
        throw error;
      }
    }
  });

  it('should configure agent with custom temperature and maxTokens', () => {
    const agent = new Agent({
      llm: LLM.gpt4o,
      inputFormat: z.object({
        query: z.string(),
      }),
      outputFormat: z.object({
        response: z.string(),
      }),
      temperature: 0.1,
      maxTokens: 500,
      systemPrompt: 'You are a precise assistant that gives brief responses.',
    });

    expect(agent).toBeDefined();
    console.log('✅ Custom configuration parameters working correctly');
  });
});