/**
 * state-machine.ts — Finite State Machine
 *
 * Manage agent conversation states with typed transitions.
 *
 * Usage:
 *   const fsm = new StateMachine('idle')
 *     .addTransition('idle', 'start', 'running')
 *     .addTransition('running', 'complete', 'done')
 *     .onEnter('running', (ctx) => console.log('Started!'));
 *   fsm.send('start');
 */

export type StateHandler<TCtx = any> = (context: TCtx) => void | Promise<void>;

export interface Transition {
    from: string;
    event: string;
    to: string;
    guard?: (context: any) => boolean;
}

export interface StateMachineSnapshot {
    currentState: string;
    history: Array<{ from: string; event: string; to: string; timestamp: number }>;
    context: any;
}

export class StateMachine<TCtx = Record<string, any>> {
    private state: string;
    private transitions: Transition[] = [];
    private enterHandlers = new Map<string, StateHandler<TCtx>[]>();
    private exitHandlers = new Map<string, StateHandler<TCtx>[]>();
    private history: Array<{ from: string; event: string; to: string; timestamp: number }> = [];
    context: TCtx;

    constructor(initialState: string, context?: TCtx) {
        this.state = initialState;
        this.context = context ?? ({} as TCtx);
    }

    /** Add a state transition */
    addTransition(from: string, event: string, to: string, guard?: (ctx: TCtx) => boolean): this {
        this.transitions.push({ from, event, to, guard });
        return this;
    }

    /** Register an onEnter handler for a state */
    onEnter(state: string, handler: StateHandler<TCtx>): this {
        if (!this.enterHandlers.has(state)) this.enterHandlers.set(state, []);
        this.enterHandlers.get(state)!.push(handler);
        return this;
    }

    /** Register an onExit handler for a state */
    onExit(state: string, handler: StateHandler<TCtx>): this {
        if (!this.exitHandlers.has(state)) this.exitHandlers.set(state, []);
        this.exitHandlers.get(state)!.push(handler);
        return this;
    }

    /** Send an event to trigger a transition */
    async send(event: string): Promise<boolean> {
        const transition = this.transitions.find(
            t => t.from === this.state && t.event === event,
        );

        if (!transition) return false;

        // Check guard
        if (transition.guard && !transition.guard(this.context)) return false;

        const prevState = this.state;

        // Exit handlers
        const exitHandlers = this.exitHandlers.get(prevState) || [];
        for (const handler of exitHandlers) await handler(this.context);

        // Transition
        this.state = transition.to;
        this.history.push({
            from: prevState,
            event,
            to: transition.to,
            timestamp: Date.now(),
        });

        // Enter handlers
        const enterHandlers = this.enterHandlers.get(this.state) || [];
        for (const handler of enterHandlers) await handler(this.context);

        return true;
    }

    /** Get current state */
    get currentState(): string {
        return this.state;
    }

    /** Check if an event can be sent from current state */
    canSend(event: string): boolean {
        return this.transitions.some(
            t => t.from === this.state && t.event === event,
        );
    }

    /** Get available events from current state */
    get availableEvents(): string[] {
        return this.transitions
            .filter(t => t.from === this.state)
            .map(t => t.event);
    }

    /** Get all defined states */
    get states(): string[] {
        const all = new Set<string>();
        for (const t of this.transitions) {
            all.add(t.from);
            all.add(t.to);
        }
        return [...all];
    }

    /** Get transition history */
    get transitionHistory() {
        return [...this.history];
    }

    /** Reset to a specific state */
    reset(state?: string): void {
        this.state = state ?? this.transitions[0]?.from ?? this.state;
        this.history = [];
    }

    /** Take a snapshot */
    snapshot(): StateMachineSnapshot {
        return {
            currentState: this.state,
            history: [...this.history],
            context: { ...this.context },
        };
    }

    /** Check if in a specific state */
    is(state: string): boolean {
        return this.state === state;
    }
}
