# Multi-Agent Chat Example

This example demonstrates how to build a multi-agent orchestration system using GXAI with:
- Multiple specialized AI agents running as separate processes
- A chat interface that sends prompts to all agents simultaneously
- Process management via BGR (Background Runner)
- Analytics integration with the GXAI Dashboard

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Multi-Agent Chat UI                      │
│                   (Melina.js Frontend)                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Orchestrator Server                       │
│              (Process Management + Routing)                  │
└─────────────────────────────────────────────────────────────┘
        │              │              │              │
        ▼              ▼              ▼              ▼
   ┌────────┐    ┌────────┐    ┌────────┐    ┌────────┐
   │Summa-  │    │Trans-  │    │Analyst │    │Creative│
   │rizer   │    │lator   │    │        │    │        │
   │:4001   │    │:4002   │    │:4003   │    │:4004   │
   └────────┘    └────────┘    └────────┘    └────────┘
        │              │              │              │
        └──────────────┴──────────────┴──────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  GXAI Analytics │
                    │   Dashboard     │
                    │    :3001        │
                    └─────────────────┘
```

## Agents

| Agent | Port | Description |
|-------|------|-------------|
| 📝 Summarizer | 4001 | Summarizes content and extracts key points |
| 🌍 Translator | 4002 | Translates to Spanish, Japanese, and French |
| 📊 Analyst | 4003 | Provides analysis, sentiment, and suggestions |
| 🎨 Creative | 4004 | Generates poems, stories, and metaphors |

## Quick Start

1. **Start the GXAI Analytics Dashboard** (if not already running):
   ```bash
   cd /home/galaxy/gxai
   bgr --name gxai-dashboard --command "bun run src/cli.ts --serve --port 3002" --directory .
   ```

2. **Start the Multi-Agent Chat server**:
   ```bash
   cd /home/galaxy/gxai/examples/multi-agent-chat
   bgr --name multi-agent-chat --command "bun run server.ts" --directory .
   ```

3. **Open the Chat UI**: http://localhost:3003

4. **Start agents** using the sidebar UI, or manually:
   ```bash
   bgr --name summarizer --command "bun run agents/summarizer.ts" --directory .
   bgr --name translator --command "bun run agents/translator.ts" --directory .
   bgr --name analyst --command "bun run agents/analyst.ts" --directory .
   bgr --name creative --command "bun run agents/creative.ts" --directory .
   ```

5. **View analytics**: http://localhost:3001

## Features

- **Process Management**: Start/stop agents directly from the UI
- **Parallel Processing**: All running agents process the prompt simultaneously
- **Analytics Integration**: Every agent request is logged to the GXAI Dashboard
- **Real-time Updates**: Agent status updates every 5 seconds
- **Chat History**: Conversation persists across page reloads

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chat` | GET | Get chat history |
| `/api/chat` | POST | Send a message to all agents |
| `/api/processes` | GET | Get status of all agent processes |
| `/api/start` | POST | Start an agent by name |
| `/api/stop` | POST | Stop an agent by name |

## Customization

To add a new agent:

1. Create a new file in `agents/` following the pattern of existing agents
2. Add the agent configuration to `AGENTS` array in `orchestrator.ts`
3. The UI will automatically detect and display the new agent
