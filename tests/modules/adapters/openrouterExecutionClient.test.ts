import { describe, expect, it } from "vitest";

import { OpenRouterExecutionClient } from "../../../src/modules/adapters/openrouter/openrouterExecutionClient.js";
import type { DirectRoutePlan } from "../../../src/modules/routing/routingTypes.js";

describe("OpenRouterExecutionClient", () => {
  it("sends the selected model to OpenRouter and maps the response back to the requested alias", async () => {
    const calls: Array<{ url: string; body: string | undefined }> = [];
    const client = new OpenRouterExecutionClient({
      apiKey: "test-key",
      fetch: async (url, init) => {
        calls.push({
          url,
          body: init?.body
        });

        return {
          ok: true,
          status: 200,
          async json() {
            return {
              id: "chatcmpl_upstream",
              created: 1773390000,
              model: "qwen/qwen3-coder:free",
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: "Hello from upstream."
                  },
                  finish_reason: "stop"
                }
              ],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 5,
                total_tokens: 15
              }
            };
          }
        };
      }
    });

    const result = await client.executeChatCompletion({
      request: {
        model: "auto:coding",
        messages: [
          {
            role: "user",
            content: "Write a unit test."
          }
        ]
      },
      routePlan: createRoutePlan()
    });

    expect(JSON.parse(calls[0]?.body ?? "{}")).toMatchObject({
      model: "qwen/qwen3-coder:free"
    });
    expect(result).toMatchObject({
      actualModel: "qwen/qwen3-coder:free",
      attemptedModels: ["qwen/qwen3-coder:free"],
      fallbackUsed: false,
      response: {
        id: "chatcmpl_upstream",
        model: "auto:coding",
        choices: [
          {
            message: {
              content: "Hello from upstream."
            }
          }
        ]
      }
    });
  });

  it("retries the fallback chain on retriable upstream failures", async () => {
    let callCount = 0;
    const attemptedModels: string[] = [];
    const client = new OpenRouterExecutionClient({
      apiKey: "test-key",
      fetch: async (_url, init) => {
        const payload = JSON.parse(init?.body ?? "{}");
        attemptedModels.push(payload.model);
        callCount += 1;

        if (callCount === 1) {
          return {
            ok: false,
            status: 503,
            async json() {
              return {};
            },
            async text() {
              return "temporary outage";
            }
          };
        }

        return {
          ok: true,
          status: 200,
          async json() {
            return {
              id: "chatcmpl_retry",
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: "Recovered on fallback."
                  },
                  finish_reason: "stop"
                }
              ]
            };
          }
        };
      }
    });

    const result = await client.executeChatCompletion({
      request: {
        model: "auto:free",
        messages: [
          {
            role: "user",
            content: "Say hi."
          }
        ]
      },
      routePlan: {
        ...createRoutePlan(),
        requested_model: "auto:free",
        fallback_chain: ["generic/free-model"]
      }
    });

    expect(attemptedModels).toEqual(["qwen/qwen3-coder:free", "generic/free-model"]);
    expect(result).toMatchObject({
      actualModel: "generic/free-model",
      attemptedModels: ["qwen/qwen3-coder:free", "generic/free-model"],
      fallbackUsed: true
    });
    expect(result.response.choices[0]?.message.content).toBe("Recovered on fallback.");
  });

  it("continues the fallback chain when a provider rejects a model for geo or provider-side reasons", async () => {
    const attemptedModels: string[] = [];
    const client = new OpenRouterExecutionClient({
      apiKey: "test-key",
      fetch: async (_url, init) => {
        const payload = JSON.parse(init?.body ?? "{}");
        attemptedModels.push(payload.model);

        if (attemptedModels.length === 1) {
          return {
            ok: false,
            status: 400,
            async json() {
              return {};
            },
            async text() {
              return JSON.stringify({
                error: {
                  message: "Provider returned error",
                  metadata: {
                    raw: JSON.stringify({
                      error: {
                        message: "User location is not supported for the API use.",
                        status: "FAILED_PRECONDITION"
                      }
                    })
                  }
                }
              });
            }
          };
        }

        return {
          ok: true,
          status: 200,
          async json() {
            return {
              id: "chatcmpl_geo_retry",
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: "Recovered after provider rejection."
                  },
                  finish_reason: "stop"
                }
              ]
            };
          }
        };
      }
    });

    const result = await client.executeChatCompletion({
      request: {
        model: "auto:free",
        messages: [
          {
            role: "user",
            content: "Say hi."
          }
        ]
      },
      routePlan: {
        ...createRoutePlan(),
        requested_model: "auto:free",
        fallback_chain: ["generic/free-model"]
      }
    });

    expect(attemptedModels).toEqual(["qwen/qwen3-coder:free", "generic/free-model"]);
    expect(result).toMatchObject({
      actualModel: "generic/free-model",
      attemptedModels: ["qwen/qwen3-coder:free", "generic/free-model"],
      fallbackUsed: true
    });
    expect(result.response.choices[0]?.message.content).toBe("Recovered after provider rejection.");
  });

  it("uses the runtime fallback plan for explicit model ids after retriable runtime failure", async () => {
    const attemptedModels: string[] = [];
    const client = new OpenRouterExecutionClient({
      apiKey: "test-key",
      fetch: async (_url, init) => {
        const payload = JSON.parse(init?.body ?? "{}");
        attemptedModels.push(payload.model);

        if (attemptedModels.length === 1) {
          return {
            ok: false,
            status: 404,
            async json() {
              return {};
            },
            async text() {
              return "model endpoint not found";
            }
          };
        }

        return {
          ok: true,
          status: 200,
          async json() {
            return {
              id: "chatcmpl_runtime_fallback",
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: "Recovered on runtime fallback."
                  },
                  finish_reason: "stop"
                }
              ]
            };
          }
        };
      }
    });

    const result = await client.executeChatCompletion({
      request: {
        model: "openai/gpt-oss-120b:free",
        messages: [
          {
            role: "user",
            content: "Say hi."
          }
        ]
      },
      routePlan: {
        ...createRoutePlan(),
        requested_model: "openai/gpt-oss-120b:free",
        resolved_model: {
          requested_model: "openai/gpt-oss-120b:free",
          requested_alias: null,
          explicit_model_id: "openai/gpt-oss-120b:free",
          prefer_free: true,
          required_modalities: ["text"]
        },
        selected_model: "openai/gpt-oss-120b:free",
        runtime_fallback: {
          trigger: "explicit_model_runtime_failure",
          selected_model: "qwen/qwen3-next-80b-a3b-instruct:free",
          fallback_chain: ["google/gemma-3-27b-it:free"],
          reasons: ["runtime fallback"],
          ranked_candidates: []
        }
      }
    });

    expect(attemptedModels).toEqual([
      "openai/gpt-oss-120b:free",
      "qwen/qwen3-next-80b-a3b-instruct:free"
    ]);
    expect(result).toMatchObject({
      actualModel: "qwen/qwen3-next-80b-a3b-instruct:free",
      attemptedModels: [
        "openai/gpt-oss-120b:free",
        "qwen/qwen3-next-80b-a3b-instruct:free"
      ],
      fallbackUsed: true,
      runtimeFallbackUsed: true
    });
    expect(result.response.choices[0]?.message.content).toBe("Recovered on runtime fallback.");
    expect(result.response.model).toBe("openai/gpt-oss-120b:free");
  });

  it("streams SSE chunks and rewrites the response model to the requested alias", async () => {
    const attemptedModels: string[] = [];
    const encoder = new TextEncoder();
    const client = new OpenRouterExecutionClient({
      apiKey: "test-key",
      fetch: async (_url, init) => {
        const payload = JSON.parse(init?.body ?? "{}");
        attemptedModels.push(payload.model);

        return {
          ok: true,
          status: 200,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  "data: {\"id\":\"chatcmpl_stream\",\"object\":\"chat.completion.chunk\",\"model\":\"qwen/qwen3-coder:free\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"},\"finish_reason\":null}]}\n\n"
                )
              );
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            }
          }),
          async json() {
            return {};
          }
        };
      }
    });

    const result = await client.executeChatCompletionStream?.({
      request: {
        model: "auto:coding",
        stream: true,
        messages: [
          {
            role: "user",
            content: "Write a unit test."
          }
        ]
      },
      routePlan: createRoutePlan()
    });
    const chunks: string[] = [];

    for await (const chunk of result?.stream ?? []) {
      chunks.push(chunk);
    }

    expect(attemptedModels).toEqual(["qwen/qwen3-coder:free"]);
    expect(result).toMatchObject({
      actualModel: "qwen/qwen3-coder:free",
      attemptedModels: ["qwen/qwen3-coder:free"],
      fallbackUsed: false
    });
    expect(chunks.join("")).toContain("\"model\":\"auto:coding\"");
    expect(chunks.join("")).toContain("data: [DONE]");
  });

  it("preserves upstream tool_calls in non-streaming chat responses", async () => {
    const client = new OpenRouterExecutionClient({
      apiKey: "test-key",
      fetch: async () => ({
        ok: true,
        status: 200,
        async json() {
          return {
            id: "chatcmpl_tools",
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
            ]
          };
        }
      })
    });

    const result = await client.executeChatCompletion({
      request: {
        model: "auto:coding",
        messages: [
          {
            role: "user",
            content: "Call the weather tool."
          }
        ]
      },
      routePlan: createRoutePlan()
    });

    expect(result.response.choices[0]).toMatchObject({
      finish_reason: "tool_calls",
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
      }
    });
  });

  it("sends strict-output guardrails to the upstream payload for exact-output prompts", async () => {
    const payloads: Array<Record<string, unknown>> = [];
    const client = new OpenRouterExecutionClient({
      apiKey: "test-key",
      fetch: async (_url, init) => {
        payloads.push(JSON.parse(init?.body ?? "{}"));

        return {
          ok: true,
          status: 200,
          async json() {
            return {
              id: "chatcmpl_strict",
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: "smoke-ok"
                  },
                  finish_reason: "stop"
                }
              ]
            };
          }
        };
      }
    });

    await client.executeChatCompletion({
      request: {
        model: "auto:free",
        messages: [
          {
            role: "user",
            content: "请只回复 smoke-ok，不要输出其他内容。"
          }
        ]
      },
      routePlan: {
        ...createRoutePlan(),
        requested_model: "auto:free"
      }
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      model: "qwen/qwen3-coder:free",
      temperature: 0
    });
    expect(payloads[0]?.messages).toEqual([
      expect.objectContaining({
        role: "developer",
        content: expect.stringContaining("Exact reply: smoke-ok")
      }),
      expect.objectContaining({
        role: "user",
        content: "请只回复 smoke-ok，不要输出其他内容。"
      })
    ]);
  });
});

function createRoutePlan(): DirectRoutePlan {
  return {
    mode: "direct",
    requested_model: "auto:coding",
    resolved_model: {
      requested_model: "auto:coding",
      requested_alias: "auto:coding",
      prefer_free: true,
      required_modalities: ["text"]
    },
    normalized_request: {
      task_type: "coding",
      required_modalities: ["text"],
      required_features: [],
      preferred_context_length: 16000,
      allow_paid_fallback: false,
      debug: false
    },
    selected_model: "qwen/qwen3-coder:free",
    fallback_chain: [],
    reasons: ["selected the highest-scoring eligible candidate for direct execution"],
    ranked_candidates: [
      {
        model_id: "qwen/qwen3-coder:free",
        display_name: "Qwen 3 Coder",
        final_score: 0.91,
        breakdown: {
          capability_score: 1,
          task_prior_score: 0.95,
          uptime_score: 0.9,
          latency_score: 0.86,
          throughput_score: 0.83,
          recent_success_score: 0.88
        }
      }
    ]
  };
}
