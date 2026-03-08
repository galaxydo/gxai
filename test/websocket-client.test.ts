import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { AgentWebSocketClient } from "../src/websocket-client";
import { serve, Server } from "bun";

describe("AgentWebSocketClient", () => {
    let server: Server;
    const PORT = 3000 + Math.floor(Math.random() * 1000);
    const URL = `ws://localhost:${PORT}`;

    beforeAll(() => {
        // Stand up a mock native Bun websocket server
        server = serve({
            port: PORT,
            fetch(req, server) {
                if (server.upgrade(req)) return;
                return new Response("Upgrade failed", { status: 500 });
            },
            websocket: {
                message(ws, message) {
                    if (message === "ping") {
                        ws.send("pong");
                        return;
                    }

                    try {
                        const data = JSON.parse(message.toString());
                        if (data.jsonrpc === "2.0" && data.method === "echo") {
                            // successful response
                            ws.send(JSON.stringify({
                                jsonrpc: "2.0",
                                id: data.id,
                                result: data.params
                            }));
                        } else if (data.jsonrpc === "2.0" && data.method === "error") {
                            // error response
                            ws.send(JSON.stringify({
                                jsonrpc: "2.0",
                                id: data.id,
                                error: { code: -32000, message: "Custom error" }
                            }));
                        } else if (data.jsonrpc === "2.0" && data.method === "push") {
                            // server notification
                            ws.send(JSON.stringify({
                                jsonrpc: "2.0",
                                method: "pushed",
                                params: data.params
                            }));
                        }
                    } catch (err) { }
                },
            },
        });
    });

    afterAll(() => {
        server.stop();
    });

    test("successfully connects and echoes via JSON-RPC", async () => {
        const client = new AgentWebSocketClient({ url: URL });

        await new Promise<void>((resolve) => {
            client.onOpen = () => resolve();
            client.connect();
        });

        expect(client.isConnected).toBe(true);

        const result = await client.request("echo", { hello: "world" });
        expect(result).toEqual({ hello: "world" });

        client.disconnect();
    });

    test("handles JSON-RPC errors correctly", async () => {
        const client = new AgentWebSocketClient({ url: URL });

        await new Promise<void>((resolve) => {
            client.onOpen = () => resolve();
            client.connect();
        });

        let err: Error | undefined;
        try {
            await client.request("error");
        } catch (e: any) {
            err = e;
        }

        expect(err).toBeDefined();
        if (err) {
            expect(err.message).toBe("[-32000] Custom error");
        }

        client.disconnect();
    });

    test("handles server-to-client notifications", async () => {
        const client = new AgentWebSocketClient({ url: URL });

        await new Promise<void>((resolve) => {
            client.onOpen = () => resolve();
            client.connect();
        });

        const notifyPromise = new Promise<any>((resolve) => {
            client.onNotification = (method, params) => {
                if (method === "pushed") {
                    resolve(params);
                }
            };
        });

        // Trigger a push using a fire-and-forget message
        client.notify("push", { someData: 123 });

        const received = await notifyPromise;
        expect(received).toEqual({ someData: 123 });

        client.disconnect();
    });
});
