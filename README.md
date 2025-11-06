# gx402

[![npm version](https://badge.fury.io/js/gx402.svg)](https://badge.fury.io/js/gx402)
[![Bun](https://img.shields.io/badge/Bun-tested-blueviolet)](https://bun.sh/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

gx402 is a lightweight TypeScript library for building AI agents powered by large language models (LLMs). It emphasizes structured inputs and outputs using [Zod](https://zod.dev/) schemas, with built-in support for real-time streaming updates. Perfect for applications needing progressive, token-by-token responses while maintaining type safety and parseable results.

Key features:
- **Structured I/O**: Define input and output schemas with Zod for validation and type inference.
- **Streaming Support**: Receive token-by-token updates for fields, including progressive content building.
- **Agent Abstraction**: Simple `Agent` class to orchestrate LLM calls with customizable temperature and models.
- **Progress Tracking**: Optional callbacks for monitoring stages like streaming or completion.
- **Nested Schema Flattening**: Nested output fields are automatically flattened for streaming (e.g., `analysis.step1` becomes `analysis_step1`).

Supports modern runtimes like Bun and Node.js.

## Installation

Install via npm:

```bash
npm install gx402
```

You'll also need:
- [Zod](https://www.npmjs.com/package/zod) for schemas (`npm install zod`).
- An LLM provider (e.g., OpenAI-compatible API). Set your API key in environment variables (e.g., `OPENAI_API_KEY`).

For testing, use Bun's test runner: `bun add -d bun:test`.

## Quick Start

Create an agent with input/output schemas and run it with a streaming callback.

```typescript
import { z } from 'zod';
import { Agent } from 'gx402';

const agent = new Agent({
  llm: 'o4-mini-2025-04-16', // Your LLM model (e.g., OpenAI GPT variant)
  inputFormat: z.object({
    question: z.string(),
  }),
  outputFormat: z.object({
    analysis: z.object({
      step1: z.string(),
      step2: z.string(),
      step3: z.string(),
    }).describe('Step-by-step analysis of the question'),
    answer: z.string().describe('The final short concise answer to the question'),
    status: z.string().describe('just literal word OK'),
  }),
  temperature: 0.7, // Optional: Controls creativity (0-1)
});

const input = { question: 'What are the benefits of renewable energy?' };

const result = await agent.run(input, (update) => {
  if (update.stage === 'streaming') {
    console.log(`Field: ${update.field}, Partial Value: ${update.value}`);
    // Value builds progressively (e.g., "Renewable energy reduces carbon..." → "...emissions and costs.")
  }
});

console.log('Final Analysis:', result.analysis);
console.log('Final Answer:', result.answer);
console.log('Status:', result.status); // e.g., "OK"
```

### Expected Output
- **Streaming Logs** (real-time, token-by-token):
  ```
  Field: analysis, Partial Value: {"step1":"Renewable energy...
  Field: analysis, Partial Value: {"step1":"Renewable energy sources like solar and wind...
  Field: answer, Partial Value: Renewable energy offers environmental, economic...
  ...
  ```
- **Final Result** (fully parsed and validated):
  ```json
  {
    "analysis": {
      "step1": "Renewable energy sources like solar and wind reduce reliance on fossil fuels.",
      "step2": "They lower greenhouse gas emissions and combat climate change.",
      "step3": "Economically, they create jobs and reduce long-term energy costs."
    },
    "answer": "Renewable energy provides environmental protection, cost savings, and energy independence.",
    "status": "OK"
  }
  ```

Nested fields like `analysis.step1` stream as `analysis` (full JSON object building progressively) or flattened (`analysis_step1`) based on config—check your schema descriptions for hints.

## API Reference

### Agent Constructor
```typescript
new Agent(config: AgentConfig)
```

**AgentConfig**:
- `llm: string` (required): Model identifier (e.g., `'gpt-4o-mini'`, `'o4-mini-2025-04-16'`).
- `inputFormat: ZodObject` (required): Schema for validating inputs.
- `outputFormat: ZodObject` (required): Schema for parsing LLM responses. Use `.describe()` for field hints.
- `temperature?: number` (default: 0.5): Sampling temperature.
- `stream?: boolean` (default: true): Enable streaming.

### agent.run(input: InputType, callback?: UpdateCallback): Promise<OutputType>
- `input`: Object matching `inputFormat`.
- `callback?: (update: ProgressUpdate | StreamingUpdate) => void`: Optional hook for real-time events.
  - **ProgressUpdate**: `{ stage: 'starting' | 'completing' | 'error', message: string }`.
  - **StreamingUpdate**: `{ stage: 'streaming', field: string, value: string }` – `value` grows token-by-token.
- Returns: Parsed output matching `outputFormat`.

### Types
- `ProgressUpdate`: Non-streaming milestones (e.g., "Request sent").
- `StreamingUpdate`: Field-specific partial values (e.g., building JSON for `analysis`).

## Examples

### Basic Non-Streaming
```typescript
const result = await agent.run(input); // No callback, blocks until complete
```

### Custom Error Handling
```typescript
try {
  const result = await agent.run(input, (update) => {
    // Handle updates...
  });
} catch (error) {
  console.error('Agent failed:', error.message); // e.g., "Invalid API key"
}
```

### Nested Streaming
For deeply nested schemas, fields stream as flat strings (e.g., `analysis_step1: "Renewables reduce..."`). Use Zod's `.describe()` to guide the LLM on formatting.

## Testing
gx402 is tested with Bun. Run tests:

```bash
bun test
```

Example test (from `tests/streaming.test.ts`):
```typescript
import { test, expect } from 'bun:test';
import { z } from 'zod';
import { Agent, ProgressUpdate, StreamingUpdate } from 'gx402';

test('should emit streaming progress updates token-by-token', async () => {
  // ... (see full test in repo)
  expect(streamingUpdates.length).toBeGreaterThan(0);
  // Verifies progressive building and final match
}, { timeout: 60000 });
```

Note: Tests skip if API keys aren't set (e.g., for CI).

## Configuration
- **Environment Vars**: `OPENAI_API_KEY` (or provider-specific). Customize via `process.env`.
- **Timeouts**: Set via test options or extend `Agent` for production.
- **Providers**: Defaults to OpenAI-compatible; extend `LLM` class for others (e.g., Anthropic, Grok).

## Contributing
1. Fork and clone.
2. Install deps: `bun install`.
3. Run tests: `bun test`.
4. Lint: `bun run lint`.
5. Submit PRs to `main`.

Issues? Open a ticket on GitHub.

## License
MIT. See [LICENSE](LICENSE). 

Built with ❤️ for structured AI workflows. Questions? Ping `@galaxydoxyz` on X.
