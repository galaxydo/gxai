# smart-agent

Autonomous agentic loop with Skills + Objectives. Give it tools, goals, and a prompt — it loops until done.

## Install

```bash
bun add smart-agent
```

## Quick Start

```ts
import { Agent } from "smart-agent"

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
  model: string                    // LLM model (gemini-3-flash-preview, gpt-4o, claude-sonnet-4-20250514, etc.)
  objectives: Objective[]          // Goals to achieve (required, at least 1)
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

### `agent.run(prompt): AsyncGenerator<AgentEvent>`

Yields events as it works:

| Event | Fields | When |
|-------|--------|------|
| `iteration_start` | `iteration`, `elapsed` | Each loop iteration begins |
| `thinking` | `message` | LLM explains what it's doing |
| `tool_start` | `tool`, `params` | About to execute a tool |
| `tool_result` | `tool`, `result` | Tool finished |
| `objective_check` | `results[]` | After tools run, objectives are validated |
| `complete` | `iteration`, `elapsed` | All objectives met |
| `error` | `error` | Something failed (agent recovers) |
| `max_iterations` | `iteration` | Gave up |

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
