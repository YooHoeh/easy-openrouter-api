import { describe, expect, it } from "vitest";

import {
  createResponsesSseStreamFromChatStream,
  mapChatResponseToResponsesResponse,
  mapResponsesRequestToChatRequest
} from "../../../src/modules/adapters/openai/responses.js";

describe("responses adapter", () => {
  it("maps a responses request into a chat completions request", () => {
    const result = mapResponsesRequestToChatRequest({
      model: "auto:reasoning",
      instructions: "只输出 JSON。",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "读取这张发票。"
            },
            {
              type: "input_image",
              image_url: {
                url: "https://example.com/invoice.png",
                detail: "high"
              }
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          json_schema: {
            name: "invoice_summary"
          }
        }
      },
      max_output_tokens: 256,
      stream: true,
      user: "u_123"
    });

    expect(result).toMatchObject({
      model: "auto:reasoning",
      stream: true,
      max_tokens: 256,
      response_format: {
        type: "json_schema"
      },
      user: "u_123",
      messages: [
        {
          role: "developer",
          content: "只输出 JSON。"
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "读取这张发票。"
            },
            {
              type: "image_url",
              image_url: {
                url: "https://example.com/invoice.png",
                detail: "high"
              }
            }
          ]
        }
      ]
    });
  });

  it("accepts chat-style input messages and preserves temperature", () => {
    const result = mapResponsesRequestToChatRequest({
      model: "auto:free",
      temperature: 0.3,
      input: [
        {
          role: "developer",
          content: "Reply with JSON only."
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Describe this image."
            },
            {
              type: "image_url",
              image_url: {
                url: "https://example.com/cat.png",
                detail: "low"
              }
            }
          ]
        },
        {
          role: "tool",
          tool_call_id: "call_123",
          content: "tool-result"
        },
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call_123",
              type: "function",
              function: {
                name: "lookup_weather",
                arguments: "{}"
              }
            }
          ],
          content: null
        }
      ]
    });

    expect(result).toEqual({
      model: "auto:free",
      temperature: 0.3,
      messages: [
        {
          role: "developer",
          content: "Reply with JSON only."
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Describe this image."
            },
            {
              type: "image_url",
              image_url: {
                url: "https://example.com/cat.png",
                detail: "low"
              }
            }
          ]
        },
        {
          role: "tool",
          tool_call_id: "call_123",
          content: "tool-result"
        },
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call_123",
              type: "function",
              function: {
                name: "lookup_weather",
                arguments: "{}"
              }
            }
          ],
          content: null
        }
      ]
    });
  });

  it("normalizes responses-style tool_choice and preserves parallel tool call settings", () => {
    const result = mapResponsesRequestToChatRequest({
      model: "auto:free",
      input: "Call the weather tool.",
      tools: [
        {
          type: "function",
          function: {
            name: "lookup_weather"
          }
        }
      ],
      tool_choice: {
        type: "function",
        name: "lookup_weather"
      },
      parallel_tool_calls: false
    });

    expect(result).toMatchObject({
      model: "auto:free",
      parallel_tool_calls: false,
      tool_choice: {
        type: "function",
        function: {
          name: "lookup_weather"
        }
      }
    });
  });

  it("preserves top_p and metadata when mapping into chat completions", () => {
    const result = mapResponsesRequestToChatRequest({
      model: "auto:free",
      input: "Say hello.",
      top_p: 0.7,
      metadata: {
        trace_id: "trace_123",
        tenant: "demo"
      }
    });

    expect(result).toMatchObject({
      model: "auto:free",
      top_p: 0.7,
      metadata: {
        trace_id: "trace_123",
        tenant: "demo"
      }
    });
  });

  it("preserves stop, penalties, and seed when mapping into chat completions", () => {
    const result = mapResponsesRequestToChatRequest({
      model: "auto:free",
      input: "Write one line.",
      stop: ["END", "STOP"],
      presence_penalty: 0.4,
      frequency_penalty: -0.2,
      seed: 42
    });

    expect(result).toMatchObject({
      model: "auto:free",
      stop: ["END", "STOP"],
      presence_penalty: 0.4,
      frequency_penalty: -0.2,
      seed: 42
    });
  });

  it("maps a chat completion response into a responses object", () => {
    const result = mapChatResponseToResponsesResponse({
      id: "chatcmpl_123",
      object: "chat.completion",
      created: 1773393000,
      model: "auto:free",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "你好"
          },
          finish_reason: "stop"
        }
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 2,
        total_tokens: 12
      },
      route: {
        mode: "direct"
      }
    });

    expect(result).toEqual({
      id: "resp_123",
      object: "response",
      created_at: 1773393000,
      status: "completed",
      model: "auto:free",
      output: [
        {
          id: "msg_123",
          type: "message",
          status: "completed",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "你好",
              annotations: []
            }
          ]
        }
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 2,
        total_tokens: 12
      },
      route: {
        mode: "direct"
      }
    });
  });

  it("maps chat tool calls into responses function_call output items", () => {
    const result = mapChatResponseToResponsesResponse({
      id: "chatcmpl_tools",
      object: "chat.completion",
      created: 1773393002,
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
        prompt_tokens: 10,
        completion_tokens: 2,
        total_tokens: 12
      }
    });

    expect(result.output).toEqual([
      {
        id: "call_weather",
        type: "function_call",
        status: "completed",
        call_id: "call_weather",
        name: "lookup_weather",
        arguments: "{\"city\":\"Shanghai\"}"
      }
    ]);
  });

  it("rewrites a chat chunk stream into responses events", async () => {
    const stream = createResponsesSseStreamFromChatStream((async function* () {
      yield "data: {\"id\":\"chatcmpl_stream\",\"object\":\"chat.completion.chunk\",\"created\":1773393001,\"model\":\"auto:free\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\"},\"finish_reason\":null}]}\n\n";
      yield "data: {\"id\":\"chatcmpl_stream\",\"object\":\"chat.completion.chunk\",\"created\":1773393001,\"model\":\"auto:free\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hello\"},\"finish_reason\":null}]}\n\n";
      yield "data: {\"id\":\"chatcmpl_stream\",\"object\":\"chat.completion.chunk\",\"created\":1773393001,\"model\":\"auto:free\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n";
      yield "data: [DONE]\n\n";
    })(), "auto:free");

    const chunks: string[] = [];

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const body = chunks.join("");

    expect(body).toContain("event: response.created");
    expect(body).toContain("event: response.output_text.delta");
    expect(body).toContain("\"delta\":\"hello\"");
    expect(body).toContain("event: response.output_text.done");
    expect(body).toContain("event: response.completed");
    expect(body).toContain("\"model\":\"auto:free\"");
  });

  it("emits response.created before consuming upstream data", async () => {
    let sourceAdvanced = false;

    const stream = createResponsesSseStreamFromChatStream((async function* () {
      sourceAdvanced = true;
      yield "data: {\"id\":\"chatcmpl_stream\",\"object\":\"chat.completion.chunk\",\"created\":1773393001,\"model\":\"auto:free\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hello\"},\"finish_reason\":null}]}\n\n";
      yield "data: [DONE]\n\n";
    })(), "auto:free");

    const iterator = stream[Symbol.asyncIterator]();
    const firstChunk = await iterator.next();

    expect(firstChunk.done).toBe(false);
    expect(firstChunk.value).toContain("event: response.created");
    expect(firstChunk.value).toContain("\"status\":\"in_progress\"");
    expect(sourceAdvanced).toBe(false);

    await iterator.return?.(undefined);
  });

  it("rewrites chat tool call chunks into responses function call events", async () => {
    const stream = createResponsesSseStreamFromChatStream((async function* () {
      yield "data: {\"id\":\"chatcmpl_tool_stream\",\"object\":\"chat.completion.chunk\",\"created\":1773393004,\"model\":\"auto:free\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\"},\"finish_reason\":null}]}\n\n";
      yield "data: {\"id\":\"chatcmpl_tool_stream\",\"object\":\"chat.completion.chunk\",\"created\":1773393004,\"model\":\"auto:free\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_weather\",\"type\":\"function\",\"function\":{\"name\":\"lookup_weather\",\"arguments\":\"\"}}]},\"finish_reason\":null}]}\n\n";
      yield "data: {\"id\":\"chatcmpl_tool_stream\",\"object\":\"chat.completion.chunk\",\"created\":1773393004,\"model\":\"auto:free\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"{\\\"city\\\":\\\"Shanghai\\\"}\"}}]},\"finish_reason\":null}]}\n\n";
      yield "data: {\"id\":\"chatcmpl_tool_stream\",\"object\":\"chat.completion.chunk\",\"created\":1773393004,\"model\":\"auto:free\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\n";
      yield "data: [DONE]\n\n";
    })(), "auto:free");

    const chunks: string[] = [];

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const body = chunks.join("");

    expect(body).toContain("event: response.output_item.added");
    expect(body).toContain("event: response.function_call_arguments.delta");
    expect(body).toContain("event: response.function_call_arguments.done");
    expect(body).toContain("event: response.output_item.done");
    expect(body).toContain("\"type\":\"function_call\"");
    expect(body).toContain("\"name\":\"lookup_weather\"");
    expect(body).toContain("event: response.completed");
  });

  it("stops the responses stream immediately after [DONE]", async () => {
    let advancedPastDone = false;
    let sourceClosed = false;

    const stream = createResponsesSseStreamFromChatStream((async function* () {
      try {
        yield "data: {\"id\":\"chatcmpl_done_stream\",\"object\":\"chat.completion.chunk\",\"created\":1773393005,\"model\":\"auto:free\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hello\"},\"finish_reason\":null}]}\n\n";
        yield "data: [DONE]\n\n";
        advancedPastDone = true;
        yield ": keepalive\n\n";
        yield "data: {\"id\":\"chatcmpl_done_stream\",\"object\":\"chat.completion.chunk\",\"created\":1773393005,\"model\":\"auto:free\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"late\"},\"finish_reason\":null}]}\n\n";
      } finally {
        sourceClosed = true;
      }
    })(), "auto:free");

    const chunks: string[] = [];

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const body = chunks.join("");

    expect(body).toContain("\"delta\":\"hello\"");
    expect(body).toContain("event: response.completed");
    expect(body).not.toContain("late");
    expect(advancedPastDone).toBe(false);
    expect(sourceClosed).toBe(true);
  });
});
