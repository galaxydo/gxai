/**
 * LLM Provider Definitions and Types
 */

// LLM Model IDs
export const LLM = {
    "gpt-4o-mini": "gpt-4o-mini",
    gpt4o: "gpt-4o",
    gpt4: "gpt-4",
    claude: "claude-3-sonnet-20240229",
    deepseek: "deepseek-chat",
    "gemini-2.0-flash": "gemini-2.0-flash",
    "gemini-2.5-pro": "gemini-2.5-pro-preview-05-06",
} as const;

export type LLMType = typeof LLM[keyof typeof LLM];

// Progress and Streaming callback types
export interface ProgressUpdate {
    stage: "server_selection" | "tool_discovery" | "tool_invocation" | "response_generation" | "streaming" | "input_resolution" | "payment";
    message: string;
    data?: any;
}

export interface StreamingUpdate {
    stage: "streaming";
    field: string;
    value: string;
}

export type ProgressCallback = (update: ProgressUpdate) => void;
export type StreamingCallback = (update: StreamingUpdate) => void;

/**
 * Check if an LLM model is a Gemini model
 */
export function isGeminiModel(llm: LLMType): boolean {
    return llm.toString().startsWith('gemini');
}

/**
 * Get the base URL for an LLM provider
 */
export function getLLMBaseUrl(llm: LLMType): string {
    if (llm.startsWith('gpt')) {
        return 'https://api.openai.com/v1/chat/completions';
    }
    if (llm.startsWith('claude')) {
        return 'https://api.anthropic.com/v1/messages';
    }
    if (llm === 'deepseek-chat') {
        return 'https://api.deepseek.com/v1/chat/completions';
    }
    throw new Error(`Unknown LLM provider for: ${llm}`);
}

/**
 * Get API key for an LLM provider
 */
export function getLLMApiKey(llm: LLMType): string {
    if (llm.startsWith('gpt')) {
        const key = process.env.OPENAI_API_KEY;
        if (!key) throw new Error('OPENAI_API_KEY not set');
        return key;
    }
    if (llm.startsWith('claude')) {
        const key = process.env.ANTHROPIC_API_KEY;
        if (!key) throw new Error('ANTHROPIC_API_KEY not set');
        return key;
    }
    if (llm === 'deepseek-chat') {
        const key = process.env.DEEPSEEK_API_KEY;
        if (!key) throw new Error('DEEPSEEK_API_KEY not set');
        return key;
    }
    if (llm.startsWith('gemini')) {
        const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
        if (!key) throw new Error('GOOGLE_API_KEY or GEMINI_API_KEY not set');
        return key;
    }
    throw new Error(`Unknown LLM provider for: ${llm}`);
}
