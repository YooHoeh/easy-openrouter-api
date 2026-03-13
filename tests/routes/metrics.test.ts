import { afterAll, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app/buildApp.js";
import { InMemoryCatalogRepository } from "../../src/modules/catalog/catalogRepository.js";

describe("GET /v1/metrics", () => {
  const repository = new InMemoryCatalogRepository();
  repository.replaceSnapshot({
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
              id: "chatcmpl_metrics",
              object: "chat.completion",
              created: 1773395000,
              model: routePlan.requested_model,
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: "metrics-ok"
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

  it("returns a stable empty summary before traffic arrives", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/metrics"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      object: "easyapi.metrics",
      totals: {
        total_requests: 0,
        successful_requests: 0,
        failed_requests: 0,
        fallback_requests: 0,
        average_latency_ms: 0,
        max_latency_ms: 0
      },
      routes: [],
      route_modes: [],
      error_codes: []
    });
  });

  it("aggregates request outcomes across gateway routes", async () => {
    await app.inject({
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
    await app.inject({
      method: "POST",
      url: "/v1/responses",
      payload: {
        model: "auto:free"
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/metrics"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      object: "easyapi.metrics",
      window: {
        process_started_at: expect.any(String),
        last_request_at: expect.any(String)
      },
      totals: {
        total_requests: 2,
        successful_requests: 1,
        failed_requests: 1,
        fallback_requests: 0
      },
      routes: [
        expect.objectContaining({
          route: "/v1/chat/completions",
          total_requests: 1,
          successful_requests: 1,
          failed_requests: 0
        }),
        expect.objectContaining({
          route: "/v1/responses",
          total_requests: 1,
          successful_requests: 0,
          failed_requests: 1
        })
      ],
      route_modes: [
        {
          id: "direct",
          count: 1
        },
        {
          id: "validation",
          count: 1
        }
      ],
      error_codes: [
        {
          id: "invalid_request",
          count: 1
        }
      ]
    });
  });

  it("supports prometheus text export without changing the default json route", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "auto:free",
        messages: [
          {
            role: "user",
            content: "Say hello again."
          }
        ]
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/metrics?format=prometheus"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toContain("# HELP easyapi_requests_total");
    expect(response.body).toContain("easyapi_route_requests_total{route=\"/v1/chat/completions\"}");
    expect(response.body).toContain("easyapi_route_mode_total{route_mode=\"direct\"}");
  });
});
