import { afterAll, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app/buildApp.js";
import { InMemoryCatalogRepository } from "../../src/modules/catalog/catalogRepository.js";

describe("POST /v1/responses", () => {
  const repository = new InMemoryCatalogRepository();
  repository.replaceSnapshot({
    source: "openrouter",
    version: 1,
    synced_at: "2026-03-13T09:00:00.000Z",
    models: [
      {
        model_id: "qwen/qwen3-coder:free",
        display_name: "Qwen 3 Coder",
        input_modalities: ["text", "image"],
        output_modalities: ["text"],
        context_length: 128000,
        supported_parameters: ["tools", "response_format"],
        pricing: {
          prompt: "0",
          completion: "0"
        },
        is_active: true,
        is_free_text: true,
        is_free_image: false,
        provider_endpoints: [],
        health: {
          uptime_score: 0.92,
          latency_score: 0.87,
          throughput_score: 0.84,
          recent_success_score: 0.9
        },
        last_seen_at: "2026-03-13T09:00:00.000Z"
      }
    ]
  });
  const app = buildApp({
    services: {
      catalogRepository: repository,
      catalogSyncService: null,
      executionClient: {
        async executeChatCompletion({ routePlan }) {
          return {
            actualModel: routePlan.selected_model,
            attemptedModels: [routePlan.selected_model],
            fallbackUsed: false,
            response: {
              id: "chatcmpl_test",
              object: "chat.completion",
              created: 1773394000,
              model: routePlan.requested_model,
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: `Executed ${routePlan.selected_model}`
                  },
                  finish_reason: "stop"
                }
              ],
              usage: {
                prompt_tokens: 1,
                completion_tokens: 1,
                total_tokens: 2
              }
            }
          };
        }
      }
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns a completed response object", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/responses",
      payload: {
        model: "auto:free",
        input: "Say hello."
      }
    });

    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.object).toBe("response");
    expect(body.model).toBe("auto:free");
    expect(body.output[0].role).toBe("assistant");
    expect(body.output[0].content[0].text).toBe("Executed qwen/qwen3-coder:free");
    expect(body.route).toBeUndefined();
  });

  it("short-circuits pure exact-reply prompts without requiring an upstream executor", async () => {
    const shortcutApp = buildApp({
      services: {
        catalogSyncService: null,
        executionClient: null
      }
    });

    const response = await shortcutApp.inject({
      method: "POST",
      url: "/v1/responses?debug=1",
      payload: {
        model: "auto:free",
        input: "请只回复 smoke-ok，不要输出其他内容。"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      object: "response",
      model: "auto:free",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "smoke-ok"
            }
          ]
        }
      ],
      route: {
        mode: "shortcut",
        reason: "pure_exact_reply_instruction",
        exact_reply_text: "smoke-ok"
      }
    });

    await shortcutApp.close();
  });

  it("accepts chat-style input messages", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/responses",
      payload: {
        model: "auto:free",
        temperature: 0.2,
        input: [
          {
            role: "developer",
            content: "Reply with one short sentence."
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
          }
        ]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      object: "response",
      model: "auto:free"
    });
  });

  it("passes normalized tool control fields through the responses adapter", async () => {
    let capturedRequest: Record<string, unknown> | undefined;
    const passthroughApp = buildApp({
      services: {
        catalogRepository: repository,
        catalogSyncService: null,
        executionClient: {
          async executeChatCompletion({ request, routePlan }) {
            capturedRequest = request as Record<string, unknown>;

            return {
              actualModel: routePlan.selected_model,
              attemptedModels: [routePlan.selected_model],
              fallbackUsed: false,
              response: {
                id: "chatcmpl_tool_choice",
                object: "chat.completion",
                created: 1773394001,
                model: routePlan.requested_model,
                choices: [
                  {
                    index: 0,
                    message: {
                      role: "assistant",
                      content: "tool-ok"
                    },
                    finish_reason: "stop"
                  }
                ],
                usage: {
                  prompt_tokens: 1,
                  completion_tokens: 1,
                  total_tokens: 2
                }
              }
            };
          }
        }
      }
    });

    const response = await passthroughApp.inject({
      method: "POST",
      url: "/v1/responses",
      payload: {
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
      }
    });

    expect(response.statusCode).toBe(200);
    expect(capturedRequest).toMatchObject({
      parallel_tool_calls: false,
      tool_choice: {
        type: "function",
        function: {
          name: "lookup_weather"
        }
      }
    });

    await passthroughApp.close();
  });

  it("passes top_p and metadata through the responses adapter", async () => {
    let capturedRequest: Record<string, unknown> | undefined;
    const passthroughApp = buildApp({
      services: {
        catalogRepository: repository,
        catalogSyncService: null,
        executionClient: {
          async executeChatCompletion({ request, routePlan }) {
            capturedRequest = request as Record<string, unknown>;

            return {
              actualModel: routePlan.selected_model,
              attemptedModels: [routePlan.selected_model],
              fallbackUsed: false,
              response: {
                id: "chatcmpl_sampling",
                object: "chat.completion",
                created: 1773394004,
                model: routePlan.requested_model,
                choices: [
                  {
                    index: 0,
                    message: {
                      role: "assistant",
                      content: "sampling-ok"
                    },
                    finish_reason: "stop"
                  }
                ],
                usage: {
                  prompt_tokens: 1,
                  completion_tokens: 1,
                  total_tokens: 2
                }
              }
            };
          }
        }
      }
    });

    const response = await passthroughApp.inject({
      method: "POST",
      url: "/v1/responses",
      payload: {
        model: "auto:free",
        input: "Say hello.",
        top_p: 0.7,
        metadata: {
          trace_id: "trace_123",
          tenant: "demo"
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(capturedRequest).toMatchObject({
      top_p: 0.7,
      metadata: {
        trace_id: "trace_123",
        tenant: "demo"
      }
    });

    await passthroughApp.close();
  });

  it("passes stop, penalties, and seed through the responses adapter", async () => {
    let capturedRequest: Record<string, unknown> | undefined;
    const passthroughApp = buildApp({
      services: {
        catalogRepository: repository,
        catalogSyncService: null,
        executionClient: {
          async executeChatCompletion({ request, routePlan }) {
            capturedRequest = request as Record<string, unknown>;

            return {
              actualModel: routePlan.selected_model,
              attemptedModels: [routePlan.selected_model],
              fallbackUsed: false,
              response: {
                id: "chatcmpl_penalties",
                object: "chat.completion",
                created: 1773394005,
                model: routePlan.requested_model,
                choices: [
                  {
                    index: 0,
                    message: {
                      role: "assistant",
                      content: "penalties-ok"
                    },
                    finish_reason: "stop"
                  }
                ],
                usage: {
                  prompt_tokens: 1,
                  completion_tokens: 1,
                  total_tokens: 2
                }
              }
            };
          }
        }
      }
    });

    const response = await passthroughApp.inject({
      method: "POST",
      url: "/v1/responses",
      payload: {
        model: "auto:free",
        input: "Write one line.",
        stop: ["END", "STOP"],
        presence_penalty: 0.4,
        frequency_penalty: -0.2,
        seed: 42
      }
    });

    expect(response.statusCode).toBe(200);
    expect(capturedRequest).toMatchObject({
      stop: ["END", "STOP"],
      presence_penalty: 0.4,
      frequency_penalty: -0.2,
      seed: 42
    });

    await passthroughApp.close();
  });

  it("includes route metadata when debug is enabled", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/responses?debug=1",
      payload: {
        model: "auto:free",
        input: "Say hello."
      }
    });

    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.route).toMatchObject({
      mode: "direct",
      selected_model: "qwen/qwen3-coder:free",
      actual_model: "qwen/qwen3-coder:free",
      fallback_used: false
    });
  });

  it("streams responses events when stream=true", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/responses?debug=1",
      payload: {
        model: "auto:free",
        input: "Say hello.",
        stream: true
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["x-easyapi-selected-model"]).toBe("qwen/qwen3-coder:free");
    expect(response.body).toContain("event: response.created");
    expect(response.body).toContain("event: response.output_text.delta");
    expect(response.body).toContain("event: response.completed");
    expect(response.body).toContain("\"model\":\"auto:free\"");
  });

  it("streams function call events when the upstream chat stream emits tool calls", async () => {
    const streamingApp = buildApp({
      services: {
        catalogRepository: repository,
        catalogSyncService: null,
        executionClient: {
          async executeChatCompletion({ routePlan }) {
            return {
              actualModel: routePlan.selected_model,
              attemptedModels: [routePlan.selected_model],
              fallbackUsed: false,
              response: {
                id: "chatcmpl_unused",
                object: "chat.completion",
                created: 1773394002,
                model: routePlan.requested_model,
                choices: [
                  {
                    index: 0,
                    message: {
                      role: "assistant",
                      content: "unused"
                    },
                    finish_reason: "stop"
                  }
                ],
                usage: {
                  prompt_tokens: 1,
                  completion_tokens: 1,
                  total_tokens: 2
                }
              }
            };
          },
          async executeChatCompletionStream({ routePlan }) {
            return {
              actualModel: routePlan.selected_model,
              attemptedModels: [routePlan.selected_model],
              fallbackUsed: false,
              stream: (async function* () {
                yield "data: {\"id\":\"chatcmpl_route_tool_stream\",\"object\":\"chat.completion.chunk\",\"created\":1773394003,\"model\":\"auto:free\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\"},\"finish_reason\":null}]}\n\n";
                yield "data: {\"id\":\"chatcmpl_route_tool_stream\",\"object\":\"chat.completion.chunk\",\"created\":1773394003,\"model\":\"auto:free\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_weather\",\"type\":\"function\",\"function\":{\"name\":\"lookup_weather\",\"arguments\":\"\"}}]},\"finish_reason\":null}]}\n\n";
                yield "data: {\"id\":\"chatcmpl_route_tool_stream\",\"object\":\"chat.completion.chunk\",\"created\":1773394003,\"model\":\"auto:free\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"{\\\"city\\\":\\\"Shanghai\\\"}\"}}]},\"finish_reason\":null}]}\n\n";
                yield "data: {\"id\":\"chatcmpl_route_tool_stream\",\"object\":\"chat.completion.chunk\",\"created\":1773394003,\"model\":\"auto:free\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\n";
                yield "data: [DONE]\n\n";
              })()
            };
          }
        }
      }
    });

    const response = await streamingApp.inject({
      method: "POST",
      url: "/v1/responses",
      payload: {
        model: "auto:free",
        input: "Call the weather tool.",
        stream: true
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.body).toContain("event: response.output_item.added");
    expect(response.body).toContain("event: response.function_call_arguments.delta");
    expect(response.body).toContain("event: response.output_item.done");
    expect(response.body).toContain("\"name\":\"lookup_weather\"");

    await streamingApp.close();
  });

  it("rejects invalid responses requests with a stable error shape", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/responses",
      payload: {
        model: "auto:free"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        message: "Invalid responses request body.",
        type: "invalid_request_error",
        code: "invalid_request"
      }
    });
  });

  it("rejects unsupported stateful responses features instead of silently ignoring them", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/responses",
      payload: {
        model: "auto:free",
        input: "Say hello.",
        previous_response_id: "resp_123"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        message: "previous_response_id is not supported by this gateway yet.",
        type: "invalid_request_error",
        code: "invalid_request",
        param: "previous_response_id"
      }
    });
  });
});
