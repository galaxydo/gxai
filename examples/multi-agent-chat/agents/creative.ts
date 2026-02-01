/**
 * Creative Agent - Generates creative content based on user prompts
 * Run with: bgr --name creative --command "bun run agents/creative.ts" --directory .
 */
import { Agent } from '../../../main';
import { z } from 'zod';

const ANALYTICS_URL = 'http://localhost:3001/api/record';
const PORT = 4004;

const creative = new Agent({
    llm: 'gpt-4o-mini',
    inputFormat: z.object({
        prompt: z.string().describe('The creative prompt or idea'),
    }),
    outputFormat: z.object({
        poem: z.string().describe('A short poem inspired by the prompt'),
        story: z.string().describe('A micro-story (2-3 sentences)'),
        metaphor: z.string().describe('A creative metaphor'),
        emoji: z.string().describe('Emoji representation of the concept'),
    }),
    systemPrompt: `You are a creative writing expert. Given any text or concept:
1. Write a short, evocative poem (4-6 lines)
2. Create a micro-story (2-3 sentences)
3. Craft a creative metaphor
4. Express it in emojis

Be imaginative and artistic.`,
    temperature: 0.9,
});


const server = Bun.serve({
    port: PORT,
    async fetch(req) {
        const url = new URL(req.url);

        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        if (req.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        if (url.pathname === '/health') {
            return Response.json({ status: 'ok', agent: 'Creative', port: PORT }, { headers: corsHeaders });
        }

        if (url.pathname === '/process' && req.method === 'POST') {
            try {
                const { prompt } = await req.json() as { prompt: string };
                console.log(`🎨 Creative received: "${prompt.substring(0, 50)}..."`);

                const result = await creative.run({ prompt });

                console.log(`✅ Creative completed`);
                return Response.json({
                    agent: 'Creative',
                    result,
                    timestamp: Date.now(),
                }, { headers: corsHeaders });
            } catch (e) {
                console.error('❌ Creative error:', e);
                return Response.json({
                    agent: 'Creative',
                    error: e instanceof Error ? e.message : 'Unknown error',
                    timestamp: Date.now(),
                }, { status: 500, headers: corsHeaders });
            }
        }

        return new Response('Not found', { status: 404, headers: corsHeaders });
    },
});

console.log(`🎨 Creative Agent running on http://localhost:${PORT}`);
