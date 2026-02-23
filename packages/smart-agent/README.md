# smart-agent

Autonomous agentic loop with Skills + Objectives for Bun.

```
            ┌──────────────────────────────────────┐
            │         Objectives (WHAT)            │
            │  Blackbox validate() functions that   │
            │  define success criteria             │
            └────────────┬─────────────────────────┘
                         │
  prompt ──→  LLM ──→ exec tool ──→ check objectives ──→ loop
                ↑                        │
                │                        ↓
            ┌───┴──────────┐     ┌──────────────┐
            │ Skills (CTX) │     │ Met? → done  │
            │ YAML files   │     │ Not? → retry │
            │ teach CLIs   │     └──────────────┘
            └──────────────┘
```

- **Objectives** = WHAT to achieve — blackbox `validate()` functions that return `{ met, reason }`
- **Skills** = CONTEXT — YAML files the LLM reads to learn available CLIs (`git`, `bun`, `docker`, your project scripts)
- **Tools** = HOW to interact — built-in `exec`, `read_file`, `write_file`, `edit_file`, `search`, `list_dir`
- **`agent.run(prompt)`** = the trigger that kicks off the loop

The agent doesn't "know" git or bun — **skills teach it**. Validation errors are passed back to the LLM so it knows how to adjust.

## Install

```bash
bun add smart-agent
```

## Quick Start

```ts
import { Agent } from "smart-agent"

const agent = new Agent({
  model: "gemini-2.5-flash",
  // Skills teach the agent what CLIs are available
  skills: ["./skills/bun.yaml", "./skills/git.yaml"],
  // Objectives define success — blackbox validation
  objectives: [{
    name: "tests_pass",
    description: "All unit tests pass",
    validate: (state) => {
      const last = state.toolHistory.findLast(t => t.tool === "exec" && t.params.command?.includes("bun test"))
      if (!last) return { met: false, reason: "Run 'bun test' first" }
      return { met: last.result.success, reason: last.result.success ? "Tests pass" : "Tests fail" }
    }
  }],
})

// agent.run() is the trigger — skills give it context on how to proceed
for await (const event of agent.run("Fix the failing tests")) {
  console.log(event.type, event)
}
```

## Multi-turn Sessions

For chatbot-style interactions, use `Session`. It maintains conversation history and re-plans objectives each turn:

```ts
import { Session } from "smart-agent"

const session = new Session({ model: "gemini-2.5-flash" })

for await (const event of session.send("create a hello world project")) {
  if (event.type === "awaiting_confirmation") {
    // Objectives are paused — review before proceeding
    console.log("Objectives:", event.objectives)
    session.confirmObjectives()  // or session.rejectObjectives()
  }
  if (event.type === "complete") {
    console.log("Done!")
  }
}

// Follow-up — planner adjusts objectives based on context
for await (const event of session.send("now add unit tests")) {
  session.confirmObjectives()
}
```

By default, sessions require confirmation before executing (`requireConfirmation: true`). This gives the user a chance to review and approve generated objectives. Disable with `{ requireConfirmation: false }`.

## Chatbot Mode — `Agent.plan()`

For one-shot planning without sessions:

```ts
import { Agent } from "smart-agent"

for await (const event of Agent.plan(
  "Create a greeting.txt with 'Hello World'",
  { model: "gemini-2.5-flash" }
)) {
  if (event.type === "planning") {
    console.log("Generated objectives:", event.objectives)
  }
  if (event.type === "complete") {
    console.log("Done!")
  }
}
```

The planner analyzes the prompt and creates verifiable objectives using templates (`file_exists`, `file_contains`, `command_succeeds`, `command_output_contains`), then a worker agent executes them.

## Conversation History

Pass a message array instead of a string to provide conversation context:

```ts
for await (const event of agent.run([
  { role: "user", content: "fix the auth tests" },
  { role: "assistant", content: "I'll look at the test files..." },
  { role: "user", content: "focus on login.test.ts" },
])) {
  // agent has full conversation context
}
```

## How It Works

```
prompt → LLM → XML response → execute tools → check objectives → loop
```

1. Your **prompt** + system prompt (tools + skills + objectives) go to the LLM
2. LLM responds in XML with tool invocations
3. Agent executes tools and feeds results back
4. **Objectives** are checked — if all `validate()` return `met: true`, the loop ends
5. Otherwise, loop continues until all objectives pass or `maxIterations` is reached

## API

### `new Agent(config)`

```ts
interface AgentConfig {
  model: string                    // LLM model name
  objectives?: Objective[]         // Goals to achieve (required for run(), optional for plan())
  skills?: (string | Skill)[]     // YAML file paths or inline Skill objects
  maxIterations?: number           // Default: 20
  temperature?: number             // Default: 0.3
  maxTokens?: number               // Default: 8000
  cwd?: string                     // Working directory (default: process.cwd())
  toolTimeoutMs?: number           // Default: 30000
  systemPrompt?: string            // Extra system prompt text
  tools?: Tool[]                   // Additional custom tools
}
```

### `agent.run(input): AsyncGenerator<AgentEvent>`

Run with predefined objectives. Accepts `string` or `Message[]`.

### `Agent.plan(input, config): AsyncGenerator<AgentEvent>`

Dynamic mode — planner generates objectives from the prompt, then worker executes.

### Events

| Event | When |
|-------|------|
| `planning` | Planner generated objectives |
| `awaiting_confirmation` | Waiting for user to confirm objectives (Session only) |
| `iteration_start` | Loop iteration begins |
| `thinking` | LLM explains what it's doing |
| `tool_start` / `tool_result` | Tool execution |
| `objective_check` | Objectives validated |
| `complete` | All objectives met |
| `error` | Something failed (agent recovers) |
| `max_iterations` | Gave up |

## Built-in Tools

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents |
| `write_file` | Create/overwrite a file |
| `edit_file` | Find-and-replace in a file |
| `exec` | Run shell commands |
| `list_dir` | List directory contents (recursive) |
| `search` | Search for text patterns across files |

### Custom Tools

Add your own tools via the `tools` config:

```ts
const agent = new Agent({
  model: "gemini-2.5-flash",
  tools: [{
    name: "deploy",
    description: "Deploy the app to production",
    parameters: {
      env: { type: "string", description: "Target environment", required: true },
    },
    execute: async (params) => {
      // your deployment logic
      return { success: true, output: `Deployed to ${params.env}` }
    },
  }],
  objectives: [/* ... */],
})

## Skills

Skills are YAML files describing CLI tools. They're injected into the system prompt so the LLM knows how to use them via `exec`.

```yaml
# skills/git.yaml
name: git
description: Git version control
commands:
  - name: commit
    description: Create a commit
    usage: "git commit -m \"{message}\""
    params:
      message: Commit message
```

```ts
const agent = new Agent({
  model: "gemini-3-flash-preview",
  skills: ["./skills/git.yaml", "./skills/docker.yaml"],
  objectives: [/* ... */],
})
```

Built-in skills included: `git`, `docker`, `bun`, `npm`.

## Objectives

Each objective has a `validate(state)` function that checks if the goal is met:

```ts
{
  name: "tests_pass",
  description: "All unit tests pass",
  validate: (state) => {
    const lastExec = state.toolHistory.findLast(t => t.tool === "exec")
    return {
      met: lastExec?.result.success === true,
      reason: lastExec ? "Tests passed" : "No tests run yet"
    }
  }
}
```

The `state` object contains:
- `messages` — Full conversation history
- `toolHistory` — All tool calls and results
- `touchedFiles` — Set of files modified
- `iteration` — Current iteration number

## Objective Templates

When using `Agent.plan()`, the planner generates objectives using these templates:

| Template | Params | Checks |
|----------|--------|--------|
| `file_exists` | `path`, `contains?` | File exists (optionally with content) |
| `file_contains` | `path`, `text` | File contains specific text |
| `command_succeeds` | `command` | Command exits with code 0 |
| `command_output_contains` | `command`, `text` | Command output contains text |
| `custom_check` | `check` | Generic fallback |

## LLM Support

| Provider | Models | Env Var |
|----------|--------|---------|
| Google | `gemini-*` | `GEMINI_API_KEY` or `GOOGLE_API_KEY` |
| Anthropic | `claude-*` | `ANTHROPIC_API_KEY` |
| DeepSeek | `deepseek-*` | `DEEPSEEK_API_KEY` |
| OpenAI | `gpt-*`, `o3-*`, `o4-*` | `OPENAI_API_KEY` |
| Any | Other models | `OPENAI_API_KEY` + `OPENAI_BASE_URL` |

Unknown models fall back to OpenAI-compatible `/chat/completions` API using `OPENAI_BASE_URL`.

## Examples

Run any example with `bun run examples/<name>.ts`:

| Example | What it does |
|---------|--------------|
| **`skill-driven`** | ⭐ The canonical pattern — skills provide CLI context, agent fixes lint/format/type errors |
| `code-review` | Finds and fixes bugs in a deliberately broken file |
| `refactor` | Splits a monolithic file into clean modules |
| `api-gen` | Generates a REST API from a spec, writes tests, verifies them |
| `session` | Multi-turn Session with objective confirmation/rejection |
| `custom-tools` | Extends the agent with `http_get` and `json_transform` tools |
| `scaffold` | Multi-objective — creates project, writes tests, makes them pass |
| `planner` | `Agent.plan()` — generates objectives from natural language |
| `hello` | Creates a file — simplest possible agent |

```bash
export GEMINI_API_KEY=your-key
bun run examples/code-review.ts
```

## License

MIT
