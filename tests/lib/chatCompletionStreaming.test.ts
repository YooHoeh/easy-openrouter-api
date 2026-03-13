import { describe, expect, it } from "vitest";

import {
  createChatCompletionSseStream,
  createStreamingDebugHeaders,
  rewriteOpenRouterSseStream
} from "../../src/lib/chatCompletionStreaming.js";

describe("chatCompletionStreaming", () => {
  it("turns a completion response into OpenAI-like SSE frames", async () => {
    const stream = createChatCompletionSseStream({
      id: "chatcmpl_stream",
      object: "chat.completion",
      created: 1773393000,
      model: "auto:free",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "smoke-ok"
          },
          finish_reason: "stop"
        }
      ],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2
      }
    }, 4);
    const chunks: string[] = [];

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const payload = chunks.join("");

    expect(payload).toContain("\"object\":\"chat.completion.chunk\"");
    expect(payload).toContain("\"role\":\"assistant\"");
    expect(payload).toContain("\"content\":\"smok\"");
    expect(payload).toContain("\"finish_reason\":\"stop\"");
    expect(payload).toContain("data: [DONE]");
  });

  it("rewrites upstream SSE chunks to preserve the requested model alias", async () => {
    const source = ReadableStream.from([
      new TextEncoder().encode(
        "data: {\"id\":\"chatcmpl_1\",\"object\":\"chat.completion.chunk\",\"model\":\"openai/gpt-oss-120b:free\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"},\"finish_reason\":null}]}\n\n"
      ),
      new TextEncoder().encode("data: [DONE]\n\n")
    ]);
    const chunks: string[] = [];

    for await (const chunk of rewriteOpenRouterSseStream(source, "auto:free")) {
      chunks.push(chunk);
    }

    const payload = chunks.join("");

    expect(payload).toContain("\"model\":\"auto:free\"");
    expect(payload).toContain("data: [DONE]");
  });

  it("stops forwarding upstream frames after [DONE]", async () => {
    let advancedPastDone = false;
    let sourceClosed = false;

    const source = (async function* () {
      try {
        yield "data: {\"id\":\"chatcmpl_2\",\"object\":\"chat.completion.chunk\",\"model\":\"openai/gpt-oss-120b:free\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"},\"finish_reason\":null}]}\n\n";
        yield "data: [DONE]\n\n";
        advancedPastDone = true;
        yield ": OPENROUTER PROCESSING\n\n";
      } finally {
        sourceClosed = true;
      }
    })();

    const chunks: string[] = [];

    for await (const chunk of rewriteOpenRouterSseStream(source, "auto:free")) {
      chunks.push(chunk);
    }

    const payload = chunks.join("");

    expect(payload).toContain("\"content\":\"hi\"");
    expect(payload).toContain("data: [DONE]");
    expect(payload).not.toContain("OPENROUTER PROCESSING");
    expect(advancedPastDone).toBe(false);
    expect(sourceClosed).toBe(true);
  });

  it("turns tool calls into OpenAI-like streaming deltas", async () => {
    const stream = createChatCompletionSseStream({
      id: "chatcmpl_tool_stream",
      object: "chat.completion",
      created: 1773393003,
      model: "auto:free",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_weather",
                type: "function",
                function: {
                  name: "lookup_weather",
                  arguments: "{\"city\":\"Shanghai\"}"
                }
              }
            ]
          },
          finish_reason: "tool_calls"
        }
      ],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2
      }
    }, 8);
    const chunks: string[] = [];

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const payload = chunks.join("");

    expect(payload).toContain("\"tool_calls\":[{\"index\":0,\"id\":\"call_weather\"");
    expect(payload).toContain("\"arguments\":\"{\\\"city\\\"");
    expect(payload).toContain("\"finish_reason\":\"tool_calls\"");
    expect(payload).toContain("data: [DONE]");
  });

  it("builds debug headers only when debug is enabled", () => {
    expect(createStreamingDebugHeaders({
      selectedModel: "openai/gpt-oss-120b:free",
      actualModel: "z-ai/glm-4.5-air:free",
      attemptedModels: ["openai/gpt-oss-120b:free", "z-ai/glm-4.5-air:free"],
      fallbackUsed: true
    }, true)).toEqual({
      "x-easyapi-selected-model": "openai/gpt-oss-120b:free",
      "x-easyapi-actual-model": "z-ai/glm-4.5-air:free",
      "x-easyapi-fallback-used": "1",
      "x-easyapi-attempted-models": "openai/gpt-oss-120b:free,z-ai/glm-4.5-air:free"
    });
    expect(createStreamingDebugHeaders({
      selectedModel: "a",
      actualModel: "b",
      attemptedModels: ["a", "b"],
      fallbackUsed: true
    }, false)).toEqual({});
  });
});
