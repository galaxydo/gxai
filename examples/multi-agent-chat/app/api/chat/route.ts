import { getAgentStatuses, processPrompt, chatHistory } from '../../../orchestrator';

// POST /api/chat - Send a message to all running agents
export async function POST(req: Request) {
    const { prompt } = await req.json() as { prompt: string };

    if (!prompt || typeof prompt !== 'string') {
        return Response.json({ error: 'Prompt is required' }, { status: 400 });
    }

    // Add user message to history
    const userMessage = {
        id: `user-${Date.now()}`,
        role: 'user' as const,
        content: prompt,
        timestamp: Date.now(),
    };
    chatHistory.push(userMessage);

    // Process through all agents
    const agentResults = await processPrompt(prompt);

    // Create assistant response
    const assistantMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant' as const,
        content: 'Here are the results from the agents:',
        agentResults,
        timestamp: Date.now(),
    };
    chatHistory.push(assistantMessage);

    return Response.json({
        userMessage,
        assistantMessage,
    });
}

// GET /api/chat - Get chat history
export async function GET() {
    return Response.json(chatHistory);
}
