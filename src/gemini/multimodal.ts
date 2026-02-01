/**
 * Gemini Multimodal Capabilities
 * 
 * Image, Video, Music generation and Deep Research
 */

import { GoogleGenAI } from "@google/genai";

/**
 * Get a configured Gemini client
 */
export function getGeminiClient(): GoogleGenAI {
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GOOGLE_API_KEY or GEMINI_API_KEY is required');
    return new GoogleGenAI({ apiKey });
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

/**
 * Generate photorealistic images using Imagen 4
 */
export async function generateImage(config: ImageGenerationConfig): Promise<GeneratedImage[]> {
    const ai = getGeminiClient();
    const model = (ai as any).getImagenModel(config.model || 'imagen-4.0-generate-001');

    const response = await model.generateImages({
        prompt: config.prompt,
        numberOfImages: config.numberOfImages || 1,
        aspectRatio: config.aspectRatio || '1:1',
        imageSize: config.imageSize || '2K'
    });

    return response.images.map((img: any) => ({
        uri: img.uri || img.url,
        mimeType: img.mimeType || 'image/png'
    }));
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

/**
 * Generate high-fidelity videos using Veo 3.1
 */
export async function generateVideo(config: VideoGenerationConfig): Promise<GeneratedVideo> {
    const ai = getGeminiClient();
    const pollInterval = config.pollIntervalMs || 10000;

    // Start the generation
    let operation = await (ai as any).models.generateVideos({
        model: config.model || 'veo-3.1-generate-001',
        prompt: config.prompt,
        config: {
            aspect_ratio: config.aspectRatio || '16:9',
            video_resolution: config.videoResolution || '1080p'
        }
    });

    // Poll for completion
    while (!operation.done) {
        if (config.onProgress) {
            config.onProgress(`Video rendering... (${operation.progress || 'in progress'})`);
        }
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        operation = await (ai as any).operations.get(operation.name);
    }

    if (operation.error) {
        throw new Error(`Video generation failed: ${operation.error.message}`);
    }

    return {
        uri: operation.response.generatedVideos[0].uri,
        durationSeconds: 8
    };
}

// ============================================
// Music Generation (Lyria)
// ============================================

export interface MusicGenerationConfig {
    prompt: string;
    bpm?: number;
    brightness?: number;  // 0.0 (muffled) to 1.0 (crisp)
    density?: number;     // 0.0 (sparse) to 1.0 (busy)
    durationSeconds?: number;
    model?: string;
}

export interface GeneratedMusic {
    uri: string;
    durationSeconds: number;
}

/**
 * Generate instrumental music using Lyria
 */
export async function generateMusic(config: MusicGenerationConfig): Promise<GeneratedMusic> {
    const ai = getGeminiClient();

    const response = await (ai as any).models.generateMusic({
        model: config.model || 'lyria-002',
        prompt: config.prompt,
        config: {
            bpm: config.bpm || 120,
            brightness: config.brightness ?? 0.7,
            density: config.density ?? 0.5,
            duration_seconds: config.durationSeconds || 30
        }
    });

    return {
        uri: response.generatedMusic.uri,
        durationSeconds: config.durationSeconds || 30
    };
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
    report: string;        // Full markdown report
    citations: string[];   // List of sources
    interactionId: string;
}

/**
 * Perform comprehensive research using autonomous research agent
 */
export async function deepResearch(config: DeepResearchConfig): Promise<ResearchResult> {
    const ai = getGeminiClient();
    const pollInterval = config.pollIntervalMs || 15000;

    // Start the research interaction
    const interaction = await (ai as any).interactions.create({
        agent: 'deep-research-pro-preview-12-2025',
        background: config.background ?? true,
        input: [
            {
                type: 'text',
                text: config.query
            }
        ]
    });

    // Poll for completion
    let status = 'processing';
    while (status !== 'completed') {
        if (config.onProgress) {
            config.onProgress(status);
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval));

        const currentInteraction = await (ai as any).interactions.get(interaction.id);
        status = currentInteraction.status;

        if (status === 'completed') {
            const outputs = currentInteraction.outputs;
            const finalReport = outputs[outputs.length - 1].text;

            // Extract citations from the report
            const citationRegex = /\[\d+\]:\s*(https?:\/\/[^\s]+)/g;
            const citations: string[] = [];
            let match;
            while ((match = citationRegex.exec(finalReport)) !== null) {
                citations.push(match[1]);
            }

            return {
                report: finalReport,
                citations,
                interactionId: interaction.id
            };
        } else if (status === 'failed') {
            throw new Error(`Research failed: ${currentInteraction.error?.message || 'Unknown error'}`);
        }
    }

    throw new Error('Research did not complete');
}

// Namespace export for convenience
export const gemini = {
    generateImage,
    generateVideo,
    generateMusic,
    deepResearch,
};
