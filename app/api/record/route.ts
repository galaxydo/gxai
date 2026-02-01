import { addRequest, InferenceRequest } from "../../../src/analytics";

export async function POST(request: Request) {
    try {
        const body = await request.json();

        // Validate required fields
        if (!body.id || !body.agentName || !body.llm) {
            return Response.json(
                { error: "Missing required fields: id, agentName, llm" },
                { status: 400 }
            );
        }

        const inferenceRequest: InferenceRequest = {
            id: body.id,
            agentName: body.agentName,
            llm: body.llm,
            timestamp: body.timestamp || Date.now(),
            duration: body.duration || 0,
            status: body.status || 'success',
            input: body.input || {},
            output: body.output || {},
            rawPrompt: body.rawPrompt,
            rawResponse: body.rawResponse,
            toolInvocations: body.toolInvocations,
            error: body.error
        };

        addRequest(inferenceRequest);

        return Response.json({ success: true, id: inferenceRequest.id });
    } catch (error) {
        console.error("Error recording request:", error);
        return Response.json(
            { error: "Failed to record request" },
            { status: 500 }
        );
    }
}
