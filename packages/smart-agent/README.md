# smart-agent

Autonomous agentic loop with Skills + Objectives. Give it tools, goals, and a prompt — it loops until done.

## Install

```bash
bun add smart-agent
```

## Quick Start

```ts
import { Agent } from "smart-agent"

// Predefined objectives
const agent = new Agent({
  model: "gemini-3-flash-preview",
  objectives: [{
    name: "file_exists",
    description: "Create hello.txt with 'Hello World'",
    validate: async () => {
      const f = Bun.file("hello.txt")
      if (!(await f.exists())) return { met: false, reason: "File missing" }
      return { met: (await f.text()).includes("Hello"), reason: "OK" }
    }
  }],
})

for await (const event of agent.run("Create hello.txt")) {
  console.log(event.type, event)
}
```

## Chatbot Mode — `Agent.plan()`

When you don't know the objectives upfront, `Agent.plan()` uses a planner LLM to generate them from the user's message:

```ts
import { Agent } from "smart-agent"

// No predefined objectives — planner generates them
for await (const event of Agent.plan(
  "Create a greeting.txt with 'Hello World'",
  { model: "gemini-3-flash-preview" }
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
| `planning` | Planner generated objectives (plan() only) |
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

## License

MIT
