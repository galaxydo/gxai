/**
 * websocket-client.ts — Agent WebSocket Client
 *
 * Persistent WebSocket client with auto-reconnect, heartbeat (ping/pong),
 * and JSON-RPC 2.0 message framing for real-time agent communication.
 */

export interface WsClientConfig {
    /** WebSocket URL to connect to */
    url: string;
    /** Subprotocols to request */
    protocols?: string | string[];
    /** Base reconnect delay in ms (default: 1000) */
    reconnectBaseMs?: number;
    /** Max reconnect delay in ms (default: 30000) */
    reconnectMaxMs?: number;
    /** Heartbeat ping interval in ms (default: 30000) */
    heartbeatIntervalMs?: number;
    /** Time to wait for a pong before reconnecting (default: 10000) */
    heartbeatTimeoutMs?: number;
    /** Number of max reconnect attempts before giving up (default: infinite) */
    maxRetries?: number;
}

export interface JsonRpcRequest {
    jsonrpc: '2.0';
    id?: string | number;
    method: string;
    params?: any;
}

export interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: string | number;
    result?: any;
    error?: { code: number; message: string; data?: any };
}

type PromiseResolver = {
    resolve: (value: any) => void;
    reject: (error: any) => void;
    timer?: Timer;
};

export class AgentWebSocketClient {
    private ws: WebSocket | null = null;
    private config: Required<WsClientConfig>;
    private idCounter = 1;
    private pendingRequests = new Map<string | number, PromiseResolver>();
    private listeners = new Set<(message: any) => void>();

    private retryCount = 0;
    private reconnectTimer?: Timer;
    private heartbeatTimer?: Timer;
    private heartbeatTimeoutTimer?: Timer;

    // State flags
    public isConnecting = false;
    private isManuallyClosed = false;

    // Events
    public onOpen?: () => void;
    public onClose?: (code: number, reason: string) => void;
    public onError?: (error: any) => void;
    public onNotification?: (method: string, params: any) => void;

    constructor(config: WsClientConfig) {
        this.config = {
            protocols: [],
            reconnectBaseMs: 1000,
            reconnectMaxMs: 30000,
            heartbeatIntervalMs: 30000,
            heartbeatTimeoutMs: 10000,
            maxRetries: Infinity,
            ...config
        };
    }

    /** Connect to the WebSocket */
    public connect(): void {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        this.isConnecting = true;
        this.isManuallyClosed = false;

        try {
            this.ws = new WebSocket(this.config.url, this.config.protocols);

            this.ws.onopen = this.handleOpen.bind(this);
            this.ws.onmessage = this.handleMessage.bind(this);
            this.ws.onclose = this.handleClose.bind(this);
            this.ws.onerror = this.handleError.bind(this);
        } catch (error) {
            this.handleError(error);
            this.scheduleReconnect();
        }
    }

    /** Disconnect gracefully */
    public disconnect(): void {
        this.isManuallyClosed = true;
        this.isConnecting = false;
        this.clearTimers();

        if (this.ws) {
            this.ws.close(1000, 'Client disconnected');
            this.ws = null;
        }

        // Reject all pending requests
        for (const [id, resolver] of this.pendingRequests) {
            if (resolver.timer) clearTimeout(resolver.timer);
            resolver.reject(new Error('WebSocket manually closed'));
        }
        this.pendingRequests.clear();
    }

    /** Send a JSON-RPC request and await a response */
    public async request(method: string, params?: any, timeoutMs: number = 30000): Promise<any> {
        if (!this.isConnected) {
            throw new Error('WebSocket is not connected');
        }

        const id = this.idCounter++;
        const req: JsonRpcRequest = {
            jsonrpc: '2.0',
            id,
            method,
            params
        };

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`Request timeout for method ${method} after ${timeoutMs}ms`));
            }, timeoutMs);

            this.pendingRequests.set(id, { resolve, reject, timer });
            this.ws!.send(JSON.stringify(req));
        });
    }

    /** Send a fire-and-forget notification (no ID) */
    public notify(method: string, params?: any): void {
        if (!this.isConnected) {
            throw new Error('WebSocket is not connected');
        }

        const req: JsonRpcRequest = {
            jsonrpc: '2.0',
            method,
            params
        };

        this.ws!.send(JSON.stringify(req));
    }

    public get isConnected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }

    private handleOpen(): void {
        this.isConnecting = false;
        this.retryCount = 0;
        this.startHeartbeat();
        if (this.onOpen) this.onOpen();
    }

    private handleMessage(event: MessageEvent): void {
        // Reset heartbeat timeout on any message
        this.resetHeartbeatTimeout();

        if (event.data === 'pong') return; // plain text heartbeat

        try {
            const data = JSON.parse(event.data.toString());

            // Check if it's a JSON-RPC response
            if (data.jsonrpc === '2.0') {
                if ('id' in data) {
                    const resolver = this.pendingRequests.get(data.id);
                    if (resolver) {
                        this.pendingRequests.delete(data.id);
                        if (resolver.timer) clearTimeout(resolver.timer);

                        if (data.error) {
                            resolver.reject(new Error(`[${data.error.code}] ${data.error.message}`));
                        } else {
                            resolver.resolve(data.result);
                        }
                    }
                } else if ('method' in data) {
                    // Server-to-Client Notification
                    if (this.onNotification) {
                        this.onNotification(data.method, data.params);
                    }
                }
            }
        } catch (err) {
            // Ignore non-JSON messages or parse errors
        }
    }

    private handleClose(event: CloseEvent): void {
        this.clearTimers();
        if (this.onClose) this.onClose(event.code, event.reason);
        this.ws = null;

        // Reject all pending requests
        for (const [id, resolver] of this.pendingRequests) {
            if (resolver.timer) clearTimeout(resolver.timer);
            resolver.reject(new Error('WebSocket closed unexpectedly'));
        }
        this.pendingRequests.clear();

        if (!this.isManuallyClosed) {
            this.scheduleReconnect();
        }
    }

    private handleError(error: Event | Error | any): void {
        if (this.onError) this.onError(error);
    }

    private scheduleReconnect(): void {
        if (this.isConnecting || this.isManuallyClosed) return;
        if (this.retryCount >= this.config.maxRetries) return;

        this.retryCount++;
        const delay = Math.min(
            this.config.reconnectBaseMs * Math.pow(2, this.retryCount - 1),
            this.config.reconnectMaxMs
        );

        this.reconnectTimer = setTimeout(() => {
            this.connect();
        }, delay);
    }

    private startHeartbeat(): void {
        this.clearTimers();
        this.heartbeatTimer = setInterval(() => {
            if (!this.isConnected) return;

            this.ws!.send('ping');
            this.heartbeatTimeoutTimer = setTimeout(() => {
                // Pong timeout — reconnect
                this.ws!.close(4000, 'Heartbeat timeout');
            }, this.config.heartbeatTimeoutMs);
        }, this.config.heartbeatIntervalMs);
    }

    private resetHeartbeatTimeout(): void {
        if (this.heartbeatTimeoutTimer) {
            clearTimeout(this.heartbeatTimeoutTimer);
        }
    }

    private clearTimers(): void {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        if (this.heartbeatTimeoutTimer) clearTimeout(this.heartbeatTimeoutTimer);
    }
}
