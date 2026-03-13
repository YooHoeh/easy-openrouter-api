import { afterAll, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app/buildApp.js";
import { InMemoryCatalogRepository } from "../../src/modules/catalog/catalogRepository.js";
import type { RequestLogRecord } from "../../src/modules/telemetry/requestLog.js";

describe("POST /v1/chat/completions", () => {
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
              created: 1773392000,
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

  it("returns an OpenAI-compatible placeholder response", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "auto:free",
        messages: [
          {
            role: "user",
            content: "Say hello."
          }
        ]
      }
    });

    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.object).toBe("chat.completion");
    expect(body.model).toBe("auto:free");
    expect(body.choices[0].message.role).toBe("assistant");
    expect(body.choices[0].message.content).toBe("Executed qwen/qwen3-coder:free");
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
      url: "/v1/chat/completions?debug=1",
      payload: {
        model: "auto:free",
        messages: [
          {
            role: "user",
            content: "请只回复 smoke-ok，不要输出其他内容。"
          }
        ]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      object: "chat.completion",
      model: "auto:free",
      choices: [
        {
          message: {
            role: "assistant",
            content: "smoke-ok"
          }
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

  it("persists request telemetry records when a sink is configured", async () => {
    const records: RequestLogRecord[] = [];
    const telemetryApp = buildApp({
      services: {
        catalogRepository: repository,
        catalogSyncService: null,
        requestTelemetrySink: {
          async write(record) {
            records.push(record);
          }
        },
        executionClient: {
          async executeChatCompletion({ routePlan }) {
            return {
              actualModel: routePlan.selected_model,
              attemptedModels: [routePlan.selected_model],
              fallbackUsed: false,
              response: {
                id: "chatcmpl_telemetry",
                object: "chat.completion",
                created: 1773392001,
                model: routePlan.requested_model,
                choices: [
                  {
                    index: 0,
                    message: {
                      role: "assistant",
                      content: "telemetry-ok"
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

    const response = await telemetryApp.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "auto:free",
        messages: [
          {
            role: "user",
            content: "Say hello."
          }
        ]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      event: "gateway_request",
      route: "/v1/chat/completions",
      requested_model: "auto:free",
      selected_model: "qwen/qwen3-coder:free",
      actual_model: "qwen/qwen3-coder:free",
      route_mode: "direct",
      success: true
    });

    await telemetryApp.close();
  });

  it("includes normalized route metadata when debug is enabled", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions?debug=1",
      payload: {
        model: "auto:free",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Read this invoice and tell me the total amount due."
              },
              {
                type: "image_url",
                image_url: {
                  url: "https://example.com/invoice.png"
                }
              }
            ]
          }
        ]
      }
    });

    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.route.mode).toBe("direct");
    expect(body.route.normalized_request).toMatchObject({
      task_type: "document_extraction",
      required_modalities: ["text", "image"],
      required_features: [],
      debug: true
    });
    expect(body.route.selected_model).toBe("qwen/qwen3-coder:free");
    expect(body.route.actual_model).toBe("qwen/qwen3-coder:free");
    expect(body.route.fallback_used).toBe(false);
  });

  it("uses vision orchestration for explicit text-only models with image input", async () => {
    const repository = new InMemoryCatalogRepository();
    await repository.replaceSnapshot({
      source: "openrouter",
      version: 1,
      synced_at: "2026-03-13T09:00:00.000Z",
      models: [
        {
          model_id: "openai/gpt-oss-120b:free",
          display_name: "GPT OSS 120B",
          input_modalities: ["text"],
          output_modalities: ["text"],
          context_length: 128000,
          supported_parameters: [],
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
            latency_score: 0.85,
            throughput_score: 0.83,
            recent_success_score: 0.89
          },
          last_seen_at: "2026-03-13T09:00:00.000Z"
        },
        {
          model_id: "google/gemma-3-27b-it:free",
          display_name: "Gemma Vision",
          input_modalities: ["text", "image"],
          output_modalities: ["text"],
          context_length: 128000,
          supported_parameters: [],
          pricing: {
            prompt: "0",
            completion: "0"
          },
          is_active: true,
          is_free_text: true,
          is_free_image: true,
          provider_endpoints: [],
          health: {
            uptime_score: 0.9,
            latency_score: 0.86,
            throughput_score: 0.82,
            recent_success_score: 0.88
          },
          last_seen_at: "2026-03-13T09:00:00.000Z"
        }
      ]
    });

    const requestModels: string[] = [];
    const orchestrationApp = buildApp({
      services: {
        catalogRepository: repository,
        catalogSyncService: null,
        executionClient: {
          async executeChatCompletion({ request, routePlan }) {
            requestModels.push(routePlan.requested_model);

            if (routePlan.requested_model === "auto:vision") {
              return {
                actualModel: routePlan.selected_model,
                attemptedModels: [routePlan.selected_model],
                fallbackUsed: false,
                response: {
                  id: "chatcmpl_vision",
                  object: "chat.completion",
                  created: 1773392100,
                  model: "auto:vision",
                  choices: [
                    {
                      index: 0,
                      message: {
                        role: "assistant",
                        content: JSON.stringify({
                          source_type: "image",
                          summary: "Invoice total is 42 USD.",
                          raw_text: "TOTAL 42",
                          entities: [],
                          uncertainties: [],
                          confidence: 0.9
                        })
                      },
                      finish_reason: "stop"
                    }
                  ],
                  usage: {
                    prompt_tokens: 10,
                    completion_tokens: 8,
                    total_tokens: 18
                  }
                }
              };
            }

            return {
              actualModel: routePlan.selected_model,
              attemptedModels: [routePlan.selected_model],
              fallbackUsed: false,
              response: {
                id: "chatcmpl_reasoning",
                object: "chat.completion",
                created: 1773392101,
                model: routePlan.requested_model,
                choices: [
                  {
                    index: 0,
                    message: {
                      role: "assistant",
                      content: `Reasoned ${routePlan.selected_model} with ${JSON.stringify(request.messages)}`.slice(0, 400)
                    },
                    finish_reason: "stop"
                  }
                ],
                usage: {
                  prompt_tokens: 12,
                  completion_tokens: 6,
                  total_tokens: 18
                }
              }
            };
          }
        }
      }
    });

    const response = await orchestrationApp.inject({
      method: "POST",
      url: "/v1/chat/completions?debug=1",
      payload: {
        model: "openai/gpt-oss-120b:free",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Read this invoice image and explain the total amount due."
              },
              {
                type: "image_url",
                image_url: {
                  url: "https://example.com/invoice.png"
                }
              }
            ]
          }
        ]
      }
    });

    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.route.mode).toBe("orchestrated");
    expect(body.route.selected_preprocessors).toEqual(["google/gemma-3-27b-it:free"]);
    expect(body.route.reasoning_route.selected_model).toBe("openai/gpt-oss-120b:free");
    expect(body.route.reasoning_route.actual_model).toBe("openai/gpt-oss-120b:free");
    expect(body.route.preprocessors[0]).toMatchObject({
      selected_model: "google/gemma-3-27b-it:free",
      actual_model: "google/gemma-3-27b-it:free"
    });
    expect(body.choices[0].message.content).toContain("Invoice total is 42 USD.");
    expect(requestModels).toEqual(["auto:vision", "openai/gpt-oss-120b:free"]);

    await orchestrationApp.close();
  });

  it("returns an OpenAI-like SSE stream when stream=true", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions?debug=1",
      payload: {
        model: "auto:free",
        stream: true,
        messages: [
          {
            role: "user",
            content: "Say hello."
          }
        ]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["x-easyapi-selected-model"]).toBe("qwen/qwen3-coder:free");
    expect(response.headers["x-easyapi-actual-model"]).toBe("qwen/qwen3-coder:free");
    expect(response.headers["x-easyapi-fallback-used"]).toBe("0");
    expect(response.body).toContain("\"object\":\"chat.completion.chunk\"");
    expect(response.body).toContain("\"model\":\"auto:free\"");
    expect(response.body).toContain("\"content\":\"Executed qwen/qwen3-code\"");
    expect(response.body).toContain("\"content\":\"r:free\"");
    expect(response.body).toContain("data: [DONE]");
  });

  it("streams orchestrated image requests while keeping the requested alias", async () => {
    const repository = new InMemoryCatalogRepository();
    await repository.replaceSnapshot({
      source: "openrouter",
      version: 1,
      synced_at: "2026-03-13T09:00:00.000Z",
      models: [
        {
          model_id: "openai/gpt-oss-120b:free",
          display_name: "GPT OSS 120B",
          input_modalities: ["text"],
          output_modalities: ["text"],
          context_length: 128000,
          supported_parameters: [],
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
            latency_score: 0.85,
            throughput_score: 0.83,
            recent_success_score: 0.89
          },
          last_seen_at: "2026-03-13T09:00:00.000Z"
        },
        {
          model_id: "google/gemma-3-27b-it:free",
          display_name: "Gemma Vision",
          input_modalities: ["text", "image"],
          output_modalities: ["text"],
          context_length: 128000,
          supported_parameters: [],
          pricing: {
            prompt: "0",
            completion: "0"
          },
          is_active: true,
          is_free_text: true,
          is_free_image: true,
          provider_endpoints: [],
          health: {
            uptime_score: 0.9,
            latency_score: 0.86,
            throughput_score: 0.82,
            recent_success_score: 0.88
          },
          last_seen_at: "2026-03-13T09:00:00.000Z"
        }
      ]
    });

    const orchestrationApp = buildApp({
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
                id: "chatcmpl_vision_stream",
                object: "chat.completion",
                created: 1773392102,
                model: routePlan.requested_model,
                choices: [
                  {
                    index: 0,
                    message: {
                      role: "assistant",
                      content: JSON.stringify({
                        source_type: "image",
                        summary: "Invoice total is 42 USD.",
                        raw_text: "TOTAL 42",
                        entities: [],
                        uncertainties: [],
                        confidence: 0.9
                      })
                    },
                    finish_reason: "stop"
                  }
                ],
                usage: {
                  prompt_tokens: 10,
                  completion_tokens: 8,
                  total_tokens: 18
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
                yield "data: {\"id\":\"chunk_1\",\"object\":\"chat.completion.chunk\",\"created\":1773392103,\"model\":\"auto:reasoning\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\"},\"finish_reason\":null}]}\n\n";
                yield "data: {\"id\":\"chunk_1\",\"object\":\"chat.completion.chunk\",\"created\":1773392103,\"model\":\"auto:reasoning\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"The amount due is 42 USD.\"},\"finish_reason\":null}]}\n\n";
                yield "data: [DONE]\n\n";
              })()
            };
          }
        }
      }
    });

    const response = await orchestrationApp.inject({
      method: "POST",
      url: "/v1/chat/completions?debug=1",
      payload: {
        model: "auto:reasoning",
        stream: true,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Read this invoice image and explain the total amount due."
              },
              {
                type: "image_url",
                image_url: {
                  url: "https://example.com/invoice.png"
                }
              }
            ]
          }
        ]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["x-easyapi-selected-model"]).toBe("openai/gpt-oss-120b:free");
    expect(response.headers["x-easyapi-actual-model"]).toBe("openai/gpt-oss-120b:free");
    expect(response.body).toContain("\"model\":\"auto:reasoning\"");
    expect(response.body).toContain("The amount due is 42 USD.");
    expect(response.body).toContain("data: [DONE]");

    await orchestrationApp.close();
  });

  it("rejects invalid requests with a stable error shape", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "auto:free"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        message: "Invalid chat completions request body.",
        type: "invalid_request_error",
        code: "invalid_request"
      }
    });
  });
});
