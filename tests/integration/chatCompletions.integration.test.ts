import { afterAll, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app/buildApp.js";
import { InMemoryCatalogRepository } from "../../src/modules/catalog/catalogRepository.js";
import type { CatalogSnapshot } from "../../src/modules/catalog/catalogTypes.js";

describe("chat completions integration", () => {
  it("syncs the catalog on demand and executes a chat completion with route metadata", async () => {
    const repository = new InMemoryCatalogRepository();
    const app = buildApp({
      services: {
        catalogRepository: repository,
        catalogSyncService: {
          async sync() {
            const snapshot = createSnapshot();
            await repository.replaceSnapshot(snapshot);
            return snapshot;
          }
        },
        executionClient: {
          async executeChatCompletion({ routePlan }) {
            return {
              actualModel: routePlan.selected_model,
              attemptedModels: [routePlan.selected_model],
              fallbackUsed: false,
              response: {
                id: "chatcmpl_integration",
                object: "chat.completion",
                created: 1773391000,
                model: routePlan.requested_model,
                choices: [
                  {
                    index: 0,
                    message: {
                      role: "assistant",
                      content: `Selected ${routePlan.selected_model}`
                    },
                    finish_reason: "stop"
                  }
                ],
                usage: {
                  prompt_tokens: 12,
                  completion_tokens: 4,
                  total_tokens: 16
                }
              }
            };
          }
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions?debug=1",
      payload: {
        model: "auto:coding",
        tools: [
          {
            type: "function",
            function: {
              name: "save_file"
            }
          }
        ],
        messages: [
          {
            role: "user",
            content: "Debug this Fastify handler."
          }
        ]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: "chatcmpl_integration",
      model: "auto:coding",
      choices: [
        {
          message: {
            content: "Selected qwen/qwen3-coder:free"
          }
        }
      ],
      route: {
        mode: "direct",
        selected_model: "qwen/qwen3-coder:free",
        actual_model: "qwen/qwen3-coder:free",
        fallback_used: false,
        requested_model: "auto:coding"
      }
    });

    await app.close();
  });

  it("returns a stable no_eligible_model error when routing cannot find a candidate", async () => {
    const repository = new InMemoryCatalogRepository();
    await repository.replaceSnapshot({
      source: "openrouter",
      version: 1,
      synced_at: "2026-03-13T09:00:00.000Z",
      models: []
    });

    const app = buildApp({
      services: {
        catalogRepository: repository,
        catalogSyncService: null,
        executionClient: null
      }
    });

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

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: {
        message: "No eligible model matched the current routing policy.",
        type: "api_error",
        code: "no_eligible_model"
      }
    });

    await app.close();
  });

  it("streams SSE chunks while preserving the requested model alias", async () => {
    const repository = new InMemoryCatalogRepository();
    const app = buildApp({
      services: {
        catalogRepository: repository,
        catalogSyncService: {
          async sync() {
            const snapshot = createSnapshot();
            await repository.replaceSnapshot(snapshot);
            return snapshot;
          }
        },
        executionClient: {
          async executeChatCompletion({ routePlan }) {
            return {
              actualModel: routePlan.selected_model,
              attemptedModels: [routePlan.selected_model],
              fallbackUsed: false,
              response: {
                id: "chatcmpl_stream_fallback",
                object: "chat.completion",
                created: 1773391200,
                model: routePlan.requested_model,
                choices: [
                  {
                    index: 0,
                    message: {
                      role: "assistant",
                      content: `Streamed ${routePlan.selected_model}`
                    },
                    finish_reason: "stop"
                  }
                ],
                usage: {
                  prompt_tokens: 4,
                  completion_tokens: 2,
                  total_tokens: 6
                }
              }
            };
          }
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions?debug=1",
      payload: {
        model: "auto:coding",
        stream: true,
        messages: [
          {
            role: "user",
            content: "Stream this reply."
          }
        ]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["x-easyapi-selected-model"]).toBe("qwen/qwen3-coder:free");
    expect(response.body).toContain("\"model\":\"auto:coding\"");
    expect(response.body).toContain("\"content\":\"Streamed qwen/qwen3-code\"");
    expect(response.body).toContain("\"content\":\"r:free\"");
    expect(response.body).toContain("data: [DONE]");

    await app.close();
  });
});

afterAll(async () => {
  // no-op safeguard for future shared app fixtures
});

function createSnapshot(): CatalogSnapshot {
  return {
    source: "openrouter",
    version: 1,
    synced_at: "2026-03-13T09:00:00.000Z",
    models: [
      {
        model_id: "qwen/qwen3-coder:free",
        display_name: "Qwen 3 Coder",
        input_modalities: ["text"],
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
          uptime_score: 0.9,
          latency_score: 0.86,
          throughput_score: 0.83,
          recent_success_score: 0.88
        },
        last_seen_at: "2026-03-13T09:00:00.000Z"
      },
      {
        model_id: "generic/free-model",
        display_name: "Generic Free Model",
        input_modalities: ["text"],
        output_modalities: ["text"],
        context_length: 32000,
        supported_parameters: ["tools"],
        pricing: {
          prompt: "0",
          completion: "0"
        },
        is_active: true,
        is_free_text: true,
        is_free_image: false,
        provider_endpoints: [],
        health: {
          uptime_score: 0.82,
          latency_score: 0.8,
          throughput_score: 0.79,
          recent_success_score: 0.81
        },
        last_seen_at: "2026-03-13T09:00:00.000Z"
      }
    ]
  };
}
