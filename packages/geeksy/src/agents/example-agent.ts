/**
 * Example Agent - Demonstrates the Geeksy agent pattern
 * 
 * This agent:
 * - Receives messages from the message bus
 * - Decides whether to handle, ignore, spawn, or respond
 * - Uses GXAI for AI inference
 */

import { Agent, LLM } from 'gx402';
import { z } from 'zod';

const GEEKSY_API = process.env.GEEKSY_API || 'http://localhost:3005';
const PORT = parseInt(process.env.PORT || '5001');
const AGENT_ID = 'example-agent';
const AGENT_NAME = 'Example Agent';
const AGENT_EMOJI = '🧪';

// Create the GXAI agent for reasoning
const reasoner = new Agent({
    llm: LLM['gemini-2.0-flash'],
    inputFormat: z.object({
        message: z.string().describe('The incoming message to analyze'),
        agentCapabilities: z.string().describe('What this agent can do'),
    }),
    outputFormat: z.object({
        action: z.string().describe('The action to take: handle, ignore, spawn, or respond'),
        reason: z.string().describe('Why this action was chosen'),
        response: z.string().describe('If action is respond, the response content'),
    }),
    systemPrompt: `You are an agent decision-maker. Given a message, decide what action to take:
- "handle" - Process the message silently (log, store, analyze)
- "ignore" - Skip this message, it's not relevant
- "spawn" - Create a new specialized agent for this type of request
- "respond" - Send a response back to the user

Analyze the message content and context to make the best decision.
Be helpful but not overly chatty - only respond when valuable.`,
});

// HTTP server to receive messages
const server = Bun.serve({
    port: PORT,
    async fetch(req) {
        const url = new URL(req.url);

        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        if (req.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        // Health check
        if (url.pathname === '/health') {
            return Response.json({
                status: 'ok',
                agent: AGENT_NAME,
                id: AGENT_ID,
                port: PORT
            }, { headers: corsHeaders });
        }

        // Process incoming message
        if (url.pathname === '/message' && req.method === 'POST') {
            try {
                const message = await req.json();
                console.log(`${AGENT_EMOJI} ${AGENT_NAME} received: "${message.content?.substring(0, 50)}..."`);

                // Use AI to decide what to do
                const decision = await reasoner.run({
                    message: message.content,
                    agentCapabilities: 'I can analyze text, answer questions, and provide helpful responses.',
                });

                console.log(`${AGENT_EMOJI} Decision: ${decision.action} - ${decision.reason}`);

                // Report activity to Geeksy
                await reportActivity(decision.action, decision.reason, message.id);

                // If responding, queue the response
                if (decision.action === 'respond' && decision.response) {
                    await queueResponse(message.id, decision.response, message.source, message.sourceId);
                }

                return Response.json({
                    agentId: AGENT_ID,
                    action: decision.action,
                    reason: decision.reason,
                    response: decision.response,
                }, { headers: corsHeaders });

            } catch (e) {
                console.error(`${AGENT_EMOJI} Error:`, e);
                return Response.json({
                    agentId: AGENT_ID,
                    error: e instanceof Error ? e.message : 'Unknown error',
                }, { status: 500, headers: corsHeaders });
            }
        }

        return new Response('Not found', { status: 404, headers: corsHeaders });
    },
});

// Report activity to Geeksy dashboard
async function reportActivity(action: string, summary: string, messageId?: string) {
    try {
        await fetch(`${GEEKSY_API}/api/activities`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                agentId: AGENT_ID,
                agentName: AGENT_NAME,
                agentEmoji: AGENT_EMOJI,
                action,
                summary,
                messageId,
            }),
        });
    } catch (e) {
        // Silently fail if dashboard is not running
    }
}

// Queue a response to be sent back
async function queueResponse(messageId: string, content: string, targetSource: string, targetSourceId?: string) {
    try {
        await fetch(`${GEEKSY_API}/api/responses`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messageId,
                agentId: AGENT_ID,
                agentName: AGENT_NAME,
                content,
                targetSource,
                targetSourceId,
            }),
        });
    } catch (e) {
        // Silently fail if dashboard is not running
    }
}

console.log(`${AGENT_EMOJI} ${AGENT_NAME} running on http://localhost:${PORT}`);
