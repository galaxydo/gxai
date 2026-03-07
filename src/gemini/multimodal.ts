/**
 * Gemini Multimodal Capabilities
 * 
 * Image, Video, Music generation and Deep Research
 * Uses Gemini REST API directly (no SDK)
 */

import { measure } from "measure-fn";
import { getLLMApiKey } from "../types";

function getApiKey(): string {
    return getLLMApiKey('gemini-2.0-flash'); // any gemini model triggers the right env lookup
}

async function geminiPost(url: string, body: any): Promise<any> {
    const apiKey = getApiKey();
    const res = await fetch(`${url}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Gemini API ${res.status}: ${text.substring(0, 300)}`);
    }
    return res.json();
}

async function geminiGet(url: string): Promise<any> {
    const apiKey = getApiKey();
    const res = await fetch(`${url}?key=${apiKey}`);
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Gemini API ${res.status}: ${text.substring(0, 300)}`);
    }
    return res.json();
}

// ============================================
// Image Generation (Imagen 4)
// ============================================

export interface ImageGenerationConfig {
    prompt: string;
    numberOfImages?: number;
    aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
    imageSize?: '1K' | '2K' | '4K';
    model?: string;
}

export interface GeneratedImage {
    uri: string;
    mimeType: string;
}

export async function generateImage(config: ImageGenerationConfig): Promise<GeneratedImage[]> {
    const model = config.model || 'imagen-4.0-generate-001';

    return await measure(`Imagen ${model}`, async () => {
        const data = await geminiPost(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict`,
            {
                instances: [{ prompt: config.prompt }],
                parameters: {
                    sampleCount: config.numberOfImages || 1,
                    aspectRatio: config.aspectRatio || '1:1',
                    imageSize: config.imageSize || '2K',
                }
            }
        );

        return (data.predictions || []).map((pred: any) => ({
            uri: pred.bytesBase64Encoded
                ? `data:image/png;base64,${pred.bytesBase64Encoded}`
                : pred.uri || pred.url,
            mimeType: pred.mimeType || 'image/png'
        }));
    }) ?? [];
}

// ============================================
// Video Generation (Veo 3.1)
// ============================================

export interface VideoGenerationConfig {
    prompt: string;
    aspectRatio?: '16:9' | '9:16' | '1:1';
    videoResolution?: '720p' | '1080p';
    model?: string;
    pollIntervalMs?: number;
    onProgress?: (status: string) => void;
}

export interface GeneratedVideo {
    uri: string;
    durationSeconds: number;
}

export async function generateVideo(config: VideoGenerationConfig): Promise<GeneratedVideo> {
    const model = config.model || 'veo-3.1-generate-001';
    const pollInterval = config.pollIntervalMs || 10000;

    return await measure.assert(`Video ${model}`, async () => {
        // Start generation
        let operation = await geminiPost(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateVideos`,
            {
                prompt: config.prompt,
                config: {
                    aspect_ratio: config.aspectRatio || '16:9',
                    video_resolution: config.videoResolution || '1080p'
                }
            }
        );

        // Poll for completion
        while (!operation.done) {
            config.onProgress?.(`Video rendering... (${operation.metadata?.progress || 'in progress'})`);
            await new Promise(resolve => setTimeout(resolve, pollInterval));
            operation = await geminiGet(
                `https://generativelanguage.googleapis.com/v1beta/${operation.name}`
            );
        }

        if (operation.error) {
            throw new Error(`Video generation failed: ${operation.error.message}`);
        }

        return {
            uri: operation.response.generatedVideos[0].uri,
            durationSeconds: 8
        };
    });
}

// ============================================
// Music Generation (Lyria)
// ============================================

export interface MusicGenerationConfig {
    prompt: string;
    bpm?: number;
    brightness?: number;
    density?: number;
    durationSeconds?: number;
    model?: string;
}

export interface GeneratedMusic {
    uri: string;
    durationSeconds: number;
}

export async function generateMusic(config: MusicGenerationConfig): Promise<GeneratedMusic> {
    const model = config.model || 'lyria-002';

    return await measure.assert(`Music ${model}`, async () => {
        const data = await geminiPost(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateMusic`,
            {
                prompt: config.prompt,
                config: {
                    bpm: config.bpm || 120,
                    brightness: config.brightness ?? 0.7,
                    density: config.density ?? 0.5,
                    duration_seconds: config.durationSeconds || 30
                }
            }
        );

        return {
            uri: data.generatedMusic.uri,
            durationSeconds: config.durationSeconds || 30
        };
    });
}

// ============================================
// Deep Research
// ============================================

export interface DeepResearchConfig {
    query: string;
    background?: boolean;
    pollIntervalMs?: number;
    onProgress?: (status: string, partialOutput?: string) => void;
}

export interface ResearchResult {
    report: string;
    citations: string[];
    interactionId: string;
}

export async function deepResearch(config: DeepResearchConfig): Promise<ResearchResult> {
    const pollInterval = config.pollIntervalMs || 15000;

    return await measure.assert('Deep Research', async () => {
        const interaction = await geminiPost(
            'https://generativelanguage.googleapis.com/v1beta/interactions',
            {
                agent: 'deep-research-pro-preview-12-2025',
                background: config.background ?? true,
                input: [{ type: 'text', text: config.query }]
            }
        );

        let status = 'processing';
        while (status !== 'completed') {
            config.onProgress?.(status);
            await new Promise(resolve => setTimeout(resolve, pollInterval));

            const current = await geminiGet(
                `https://generativelanguage.googleapis.com/v1beta/interactions/${interaction.id}`
            );
            status = current.status;

            if (status === 'completed') {
                const outputs = current.outputs;
                const finalReport = outputs[outputs.length - 1].text;

                const citationRegex = /\[\d+\]:\s*(https?:\/\/[^\s]+)/g;
                const citations: string[] = [];
                let match;
                while ((match = citationRegex.exec(finalReport)) !== null) {
                    citations.push(match[1]!);
                }

                return { report: finalReport, citations, interactionId: interaction.id };
            } else if (status === 'failed') {
                throw new Error(`Research failed: ${current.error?.message || 'Unknown error'}`);
            }
        }

        throw new Error('Research did not complete');
    });
}

// Namespace export
export const gemini = {
    generateImage,
    generateVideo,
    generateMusic,
    deepResearch,
};
