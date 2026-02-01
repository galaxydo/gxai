/**
 * Analyst Agent - Provides analysis and insights on user prompts
 * Run with: bgr --name analyst --command "bun run agents/analyst.ts" --directory .
 */
import { Agent } from '../../../main';
import { z } from 'zod';

const ANALYTICS_URL = 'http://localhost:3001/api/record';
const PORT = 4003;

const analyst = new Agent({
    llm: 'gpt-4o-mini',
    inputFormat: z.object({
        prompt: z.string().describe('The topic or question to analyze'),
    }),
    outputFormat: z.object({
        analysis: z.string().describe('Detailed analysis of the topic'),
        sentiment: z.enum(['positive', 'negative', 'neutral']).describe('Overall sentiment'),
        topic1: z.string().describe('First main topic'),
        topic2: z.string().describe('Second main topic'),
        suggestion1: z.string().describe('First actionable suggestion'),
        suggestion2: z.string().describe('Second actionable suggestion'),
    }),
    systemPrompt: `You are an analytical expert. Given any text or question:
1. Provide a thoughtful analysis
2. Identify the overall sentiment
3. Extract 2 main topics
4. Offer 2 actionable suggestions

Be insightful and practical.`,
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
            return Response.json({ status: 'ok', agent: 'Analyst', port: PORT }, { headers: corsHeaders });
        }

        if (url.pathname === '/process' && req.method === 'POST') {
            try {
                const { prompt } = await req.json() as { prompt: string };
                console.log(`📊 Analyst received: "${prompt.substring(0, 50)}..."`);

                const result = await analyst.run({ prompt });

                console.log(`✅ Analyst completed`);
                return Response.json({
                    agent: 'Analyst',
                    result,
                    timestamp: Date.now(),
                }, { headers: corsHeaders });
            } catch (e) {
                console.error('❌ Analyst error:', e);
                return Response.json({
                    agent: 'Analyst',
                    error: e instanceof Error ? e.message : 'Unknown error',
                    timestamp: Date.now(),
                }, { status: 500, headers: corsHeaders });
            }
        }

        return new Response('Not found', { status: 404, headers: corsHeaders });
    },
});

console.log(`📊 Analyst Agent running on http://localhost:${PORT}`);
