# 🤖 Geeksy

**Multi-Agent Orchestration System with Observability Dashboard**

Geeksy is an agent orchestration platform that provides:
- **Message Bus** - Central event stream for incoming messages from various sources (Telegram, Discord, API, etc.)
- **Agent Registry** - Manage agent lifecycle with bgr
- **Activity Stream** - Real-time observability of all agent actions
- **Response Channel** - Collect and dispatch agent responses back to users
- **Dashboard UI** - Beautiful observability interface

## Architecture

```
                    ┌──────────────────────────────────────────┐
                    │         MESSAGE SOURCES                   │
                    │  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
                    │  │ Telegram │  │ Discord  │  │ Test UI │ │
                    │  └────┬─────┘  └────┬─────┘  └────┬────┘ │
                    └───────┼─────────────┼─────────────┼──────┘
                            └─────────────┼─────────────┘
                                          ▼
                    ┌──────────────────────────────────────────┐
                    │            MESSAGE BUS                    │
                    │     (Central queue with SatiDB)           │
                    └──────────────────────────────────────────┘
                            │             │             │
                ┌───────────┼─────────────┼─────────────┼───────────┐
                ▼           ▼             ▼             ▼           │
        ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐   │
        │ Agent A   │ │ Agent B   │ │ Agent C   │ │ Agent D   │   │
        │ (handles) │ │ (ignores) │ │ (spawns)  │ │ (responds)│   │
        └───────────┘ └───────────┘ └───────────┘ └───────────┘   │
                                                                   │
                    ┌──────────────────────────────────────────────┘
                    ▼
        ┌──────────────────────────────────────────────────────┐
        │              OBSERVABILITY DASHBOARD                  │
        │  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐  │
        │  │ Agent List  │  │ Message     │  │ Activity     │  │
        │  │ & Status    │  │ Stream      │  │ Logs         │  │
        │  └─────────────┘  └─────────────┘  └──────────────┘  │
        │  ┌─────────────────────────────────────────────────┐ │
        │  │              Test Message Sender                 │ │
        │  └─────────────────────────────────────────────────┘ │
        └──────────────────────────────────────────────────────┘
```

## Agent Actions

Each agent can decide to:
- **handle** - Process the message silently (log, analyze, store)
- **ignore** - Skip this message, it's not relevant
- **spawn** - Generate new agent code and start a new bgr process
- **respond** - Send a response back to the user

## Quick Start

```bash
# Start the dashboard
cd packages/geeksy
bun run dev

# Or use bgr
bgr --name geeksy --command "bun run src/cli.ts serve" --directory .
```

## Dependencies

- **gx402** - AI inference (OpenAI, Anthropic, Gemini)
- **satidb** - Persistent storage
- **bgr** - Process management
- **melina** - Frontend framework

## API Routes

- `GET /api/agents` - List all registered agents
- `POST /api/agents` - Start/stop an agent
- `GET /api/messages` - Get recent messages
- `POST /api/messages` - Publish a new message
- `GET /api/activities` - Get activity stream

## Creating an Agent

```typescript
import { Agent, LLM } from 'gx402';
import { z } from 'zod';

const myAgent = new Agent({
    llm: LLM['gemini-2.0-flash'],
    inputFormat: z.object({
        message: z.string(),
    }),
    outputFormat: z.object({
        action: z.string(), // 'handle', 'ignore', 'spawn', 'respond'
        response: z.string(),
    }),
    systemPrompt: `Decide what to do with incoming messages...`,
});
```

## License

MIT
