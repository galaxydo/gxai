import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { serveAgentDashboard } from "../src/dashboard";
import { globalBus } from "../src/event-bus";
import { costTracker } from "../src/cost-tracker";

describe("Agent Dashboard Web UI", () => {
    let dashboardOptions: ReturnType<typeof serveAgentDashboard>;

    beforeAll(() => {
        dashboardOptions = serveAgentDashboard({ port: 3456, title: "Test Dashboard" });
    });

    afterAll(() => {
        dashboardOptions.server.stop(true);
    });

    test("serves frontend HTML template at root", async () => {
        const res = await fetch(`http://localhost:3456/`);
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toContain("text/html");

        const html = await res.text();
        expect(html).toContain("Test Dashboard");
        expect(html).toContain("Live Event Stream");
        expect(html).toContain("Overview Metrics");
        expect(html).toContain("glass-panel");
    });

    test("SSE stream responds with text/event-stream", async () => {
        const res = await fetch(`http://localhost:3456/api/stream`);
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toContain("text/event-stream");

        const iterator = res.body?.getReader();
        expect(iterator).toBeDefined();

        if (iterator) {
            const { value, done } = await iterator.read();
            expect(done).toBe(false);

            const decoded = new TextDecoder().decode(value);
            expect(decoded).toContain("event: metrics_update");
            expect(decoded).toContain("data: {");

            // Should contain basic cost tracker summary payload
            expect(decoded).toContain('"totalCostUSD":');
            expect(decoded).toContain('"totalRuns":');

            iterator.cancel();
        }
    });

    test("Global EventBus emits correctly propagate to SSE", async () => {
        const res = await fetch(`http://localhost:3456/api/stream`);
        const iterator = res.body?.getReader();

        if (iterator) {
            // Read initial push metrics
            await iterator.read();

            // Trigger global bus
            globalBus.emit("test_event", { hello: "world" });

            // Read event
            const { value } = await iterator.read();
            const decoded = new TextDecoder().decode(value);

            expect(decoded).toContain("event: bus_event");
            expect(decoded).toContain("test_event");
            expect(decoded).toContain("world");

            iterator.cancel();
        }
    });
});
