/**
 * Translator Agent - Translates user input to specified languages
 * Run with: bgr --name translator --command "bun run agents/translator.ts" --directory .
 */
import { Agent } from '../../../main';
import { z } from 'zod';

const ANALYTICS_URL = 'http://localhost:3001/api/record';
const PORT = 4002;

const translator = new Agent({
    llm: 'gpt-4o-mini',
    inputFormat: z.object({
        prompt: z.string().describe('The text to translate'),
    }),
    outputFormat: z.object({
        translations: z.object({
            spanish: z.string().describe('Spanish translation'),
            japanese: z.string().describe('Japanese translation'),
            french: z.string().describe('French translation'),
        }),
        detectedLanguage: z.string().describe('The detected source language'),
    }),
    systemPrompt: `You are a translation expert. Given any text:
1. Detect the source language
2. Translate it into Spanish, Japanese, and French

Preserve the meaning and tone as much as possible.`,
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
            return Response.json({ status: 'ok', agent: 'Translator', port: PORT }, { headers: corsHeaders });
        }

        if (url.pathname === '/process' && req.method === 'POST') {
            try {
                const { prompt } = await req.json() as { prompt: string };
                console.log(`🌍 Translator received: "${prompt.substring(0, 50)}..."`);

                const result = await translator.run({ prompt });

                console.log(`✅ Translator completed`);
                return Response.json({
                    agent: 'Translator',
                    result,
                    timestamp: Date.now(),
                }, { headers: corsHeaders });
            } catch (e) {
                console.error('❌ Translator error:', e);
                return Response.json({
                    agent: 'Translator',
                    error: e instanceof Error ? e.message : 'Unknown error',
                    timestamp: Date.now(),
                }, { status: 500, headers: corsHeaders });
            }
        }

        return new Response('Not found', { status: 404, headers: corsHeaders });
    },
});

console.log(`🌍 Translator Agent running on http://localhost:${PORT}`);
