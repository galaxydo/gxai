/**
 * Summarizer Agent - Summarizes the user's input into a concise response
 * Run with: bgr --name summarizer --command "bun run agents/summarizer.ts" --directory .
 */
import { Agent } from '../../../main';
import { z } from 'zod';

const ANALYTICS_URL = 'http://localhost:3001/api/record';
const PORT = 4001;

const summarizer = new Agent({
    llm: 'gpt-4o-mini',
    inputFormat: z.object({
        prompt: z.string().describe('The user prompt to summarize'),
    }),
    outputFormat: z.object({
        summary: z.string().describe('A concise summary of the prompt'),
        keyPoint1: z.string().describe('First key point'),
        keyPoint2: z.string().describe('Second key point'),
        keyPoint3: z.string().describe('Third key point (or empty if not applicable)'),
    }),
    systemPrompt: `You are a summarization expert. Given any text or question, provide:
1. A concise summary (1-2 sentences)
2. Up to 3 key points

Be brief and focus on the essential information.`,
});



// Simple HTTP server to receive prompts
const server = Bun.serve({
    port: PORT,
    async fetch(req) {
        const url = new URL(req.url);

        // CORS headers
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        if (req.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        if (url.pathname === '/health') {
            return Response.json({ status: 'ok', agent: 'Summarizer', port: PORT }, { headers: corsHeaders });
        }

        if (url.pathname === '/process' && req.method === 'POST') {
            try {
                const { prompt } = await req.json() as { prompt: string };
                console.log(`📝 Summarizer received: "${prompt.substring(0, 50)}..."`);

                const result = await summarizer.run({ prompt });

                console.log(`✅ Summarizer completed`);
                return Response.json({
                    agent: 'Summarizer',
                    result,
                    timestamp: Date.now(),
                }, { headers: corsHeaders });
            } catch (e) {
                console.error('❌ Summarizer error:', e);
                return Response.json({
                    agent: 'Summarizer',
                    error: e instanceof Error ? e.message : 'Unknown error',
                    timestamp: Date.now(),
                }, { status: 500, headers: corsHeaders });
            }
        }

        return new Response('Not found', { status: 404, headers: corsHeaders });
    },
});

console.log(`🧠 Summarizer Agent running on http://localhost:${PORT}`);
