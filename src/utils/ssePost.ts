export type SSEEvent =
    | { event: "token"; data: { token: string } }
    | { event: "finish"; data: { finish_reason: string } }
    | { event: "done"; data: { ok: true } }
    | { event: "error"; data: { message: string } }
    | { event: string; data: any };


export async function ssePost(
    url: string,
    body: any,
    onEvent: (evt: SSEEvent) => void,
    signal?: AbortSignal
) {
    const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
    });

    if (!resp.ok) {
        throw new Error(`SSE HTTP ${resp.status}`);
    }
    if (!resp.body) {
        throw new Error("No response body for SSE");
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let sepIndex: number;
        while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, sepIndex);
            buffer = buffer.slice(sepIndex + 2);

            const lines = frame.split("\n").map((l) => l.trimEnd());
            const eventLine = lines.find((l) => l.startsWith("event:"));
            const dataLine = lines.find((l) => l.startsWith("data:"));

            if (!eventLine || !dataLine) continue;

            const event = eventLine.slice(6).trim();
            const dataStr = dataLine.slice(5).trim();

            try {
                const data = JSON.parse(dataStr);
                onEvent({ event, data } as SSEEvent);
            } catch {
                // ignore broken frames
            } 
        }
    }
}