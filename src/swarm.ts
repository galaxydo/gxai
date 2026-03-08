/**
 * swarm.ts — Multi-Agent Swarm Orchestrator
 *
 * Implements a dynamic, autonomous handoff architecture (similar to OpenAI Swarm).
 * Agents are automatically injected with a 'transfer_to_agent' tool that allows
 * them to intelligently route the user's task to another specialized agent in the Swarm.
 *
 * Usage:
 *   const swarm = new AgentSwarm({
 *     defaultAgent: 'Router',
 *     agents: {
 *       'Router': { model: 'gpt-4o-mini', systemPrompt: 'Route to appropriate expert.' },
 *       'Coder': { model: 'gpt-4o', systemPrompt: 'You write code.' },
 *       'Reviewer': { model: 'gpt-4o', systemPrompt: 'You review code.' }
 *     }
 *   });
 *   const result = await swarm.run('Please write a fast sorting algorithm in Rust.');
 */

import { Agent } from './agent';
import type { AgentConfig } from './types';
import { ConversationMemory, type MemoryMessage } from './memory';
import { GxaiError } from './errors';
import { z } from 'zod';

export interface SwarmConfig {
    /** The starting agent name */
    defaultAgent: string;
    /** Map of agent names to their configurations */
    agents: Record<string, AgentConfig<any, any>>;
    /** Optional shared memory spanning the entire swarm */
    memory?: ConversationMemory;
    /** Maximum handoffs allowed per run to prevent infinite delegation loops */
    maxHandoffs?: number;
    /** Global tool definitions available to all agents in the swarm */
    globalTools?: Record<string, any>;
}

export interface SwarmResult {
    /** The final text output */
    output: string;
    /** The name of the agent that produced the final output */
    finalAgent: string;
    /** Number of handoffs that occurred */
    handoffCount: number;
    /** Sequence of agents that participated */
    trace: string[];
    /** The shared memory context at the end of execution */
    memory: ConversationMemory;
}

export class AgentSwarm {
    private config: SwarmConfig;
    private initializedAgents: Map<string, Agent<any, any>> = new Map();
    private sharedMemory: ConversationMemory;

    constructor(config: SwarmConfig) {
        if (!config.agents[config.defaultAgent]) {
            throw new GxaiError(`Default agent "${config.defaultAgent}" must be defined in agents config.`);
        }

        this.config = {
            maxHandoffs: 10,
            ...config
        };

        this.sharedMemory = this.config.memory || new ConversationMemory();
        this.initSwarm();
    }

    private initSwarm() {
        const agentNames = Object.keys(this.config.agents);

        for (const [name, rawConfig] of Object.entries(this.config.agents)) {
            // Prevent agent from calling itself as a handoff loop
            const availableTargets = agentNames.filter(n => n !== name);

            // Build the dynamic transfer tool
            const transferTool = {
                name: 'transfer_to_agent',
                description: `Handoff execution to another specialized agent. Available agents: ${availableTargets.join(', ')}. Use this ONLY when the user's request requires expertise you do not have.`,
                schema: {
                    type: 'object',
                    properties: {
                        targetAgent: {
                            type: 'string',
                            enum: availableTargets,
                            description: 'The exact name of the agent to transfer to'
                        },
                        handoffContext: {
                            type: 'string',
                            description: 'A contextual summary of what you have done and what the target agent needs to do'
                        }
                    },
                    required: ['targetAgent', 'handoffContext']
                },
                execute: async (params: any) => {
                    // Magic string prefix that our Swarm orchestrator listens for
                    return `__SWARM_HANDOFF__:${params.targetAgent}:${params.handoffContext}`;
                }
            };

            const localTools = rawConfig.localTools || [];

            this.initializedAgents.set(name, new Agent({
                ...rawConfig,
                name: name,
                localTools: [...localTools, transferTool]
            } as any));
        }
    }

    /**
     * Executes the swarm. Starts with the default agent, and autonomously routes
     * execution through the network of agents based on 'transfer_to_agent' tool calls.
     */
    async run(input: string): Promise<SwarmResult> {
        let currentAgentName = this.config.defaultAgent;
        let handoffCount = 0;
        const trace: string[] = [currentAgentName];

        // Add user initial input to shared memory once
        this.sharedMemory.addUser(input);

        while (true) {
            const agent = this.initializedAgents.get(currentAgentName);
            if (!agent) {
                throw new GxaiError(`Swarm attempted to route to unknown agent: ${currentAgentName}`);
            }

            // Copy config memory logic — Agent.run() internally manages context injection
            // To ensure seamless context, we sync the Agent's internal memory with our shared brain
            const activeConfig = (agent as any).config as AgentConfig<any, any>;
            if (activeConfig.memory) {
                (activeConfig.memory as ConversationMemory).clear();
                for (const msg of this.sharedMemory.getMessages()) {
                    if (msg.role === 'user') activeConfig.memory.addUser(msg.content);
                    if (msg.role === 'assistant') activeConfig.memory.addAssistant(msg.content);
                }
            }

            // Wait, we bypass standard internal agent memory to prevent duplicates.
            // Run the iteration with a system prompt wrapper indicating their current identity.
            const identityPrompt = `[SYSTEM NOTIFICATION: You are ${currentAgentName}. You can transfer execution via tools if needed.]\n\n`;

            // Re-inject the last user message directly as the run input
            // to conform to the standard Agent.run(input) API, but rely on activeConfig.memory
            // to hold the historical multi-turn Swarm transcript.
            const lastMsg = this.sharedMemory.getMessages().at(-1)?.content || input;

            let output = '';
            try {
                output = await agent.run(identityPrompt + lastMsg);
            } catch (err: any) {
                throw new GxaiError(`Swarm execution crashed at agent ${currentAgentName}: ${err.message}`);
            }

            // Check if the output contains a handoff signature.
            // (Note: the Agent class stringifies tool outputs. The LLM will see the tool result
            // and might echo it, or the Agent class might just return it if we intercept the tool natively.
            // Since our transfer tool returns a magic string to the LLM, the LLM usually acknowledges it.
            // However, a more robust check looks directly at the Agent's tool invocation history,
            // but for simplicity we can inspect the raw text output for the handoff marker if the LLM parroted it,
            // or we could check the tool metrics. Let's do a robust regex scanner.)

            const handoffMatch = output.match(/__SWARM_HANDOFF__:([^:]+):([\s\S]*)/);

            if (handoffMatch && handoffMatch[1] && handoffMatch[2]) {
                const targetAgent = handoffMatch[1];
                const contextStr = handoffMatch[2];

                if (handoffCount >= (this.config.maxHandoffs || 10)) {
                    throw new GxaiError(`Swarm exceeded maximum handoffs (${this.config.maxHandoffs}). Loop detected.`);
                }

                if (!this.initializedAgents.has(targetAgent)) {
                    throw new GxaiError(`Agent ${currentAgentName} attempted handoff to unknown agent "${targetAgent}"`);
                }

                // Log the handoff context into the global brain so the next agent sees it
                this.sharedMemory.addAssistant(`[Handoff from ${currentAgentName} -> ${targetAgent}]: ${contextStr.trim()}`);

                currentAgentName = targetAgent;
                handoffCount++;
                trace.push(currentAgentName);

                // Do NOT return. Loop again with the new agent.
                continue;
            }

            // No handoff. Execution finished.
            this.sharedMemory.addAssistant(output);

            return {
                output,
                finalAgent: currentAgentName,
                handoffCount,
                trace,
                memory: this.sharedMemory
            };
        }
    }
}
