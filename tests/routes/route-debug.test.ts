import { afterAll, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app/buildApp.js";
import { InMemoryCatalogRepository } from "../../src/modules/catalog/catalogRepository.js";

describe("POST /v1/route/debug", () => {
  const repository = new InMemoryCatalogRepository();
  repository.replaceSnapshot({
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
        supported_parameters: ["response_format"],
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
          latency_score: 0.82,
          throughput_score: 0.8,
          recent_success_score: 0.87
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
          uptime_score: 0.89,
          latency_score: 0.84,
          throughput_score: 0.81,
          recent_success_score: 0.86
        },
        last_seen_at: "2026-03-13T09:00:00.000Z"
      }
    ]
  });
  const app = buildApp({
    services: {
      catalogRepository: repository,
      catalogSyncService: null,
      executionClient: null
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns direct routing analysis for a normal request", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/route/debug",
      payload: {
        model: "auto:reasoning",
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "summary"
          }
        },
        messages: [
          {
            role: "user",
            content: "Explain the trade-off and return a JSON summary."
          }
        ]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      object: "easyapi.route.debug",
      requested_model: "auto:reasoning",
      direct: {
        ok: true,
        route: {
          mode: "direct",
          selected_model: "openai/gpt-oss-120b:free"
        }
      }
    });
  });

  it("returns a vision orchestration preview for image requests", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/route/debug",
      payload: {
        model: "auto:reasoning",
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
    expect(response.json()).toMatchObject({
      object: "easyapi.route.debug",
      direct: {
        ok: true,
        route: {
          selected_model: "google/gemma-3-27b-it:free"
        }
      },
      orchestration_preview: {
        ok: true,
        route: {
          reasoning_route: {
            selected_model: "openai/gpt-oss-120b:free"
          },
          plan: {
            mode: "orchestrated",
            reasoning_model: "openai/gpt-oss-120b:free",
            preprocessors: [
              {
                type: "vision",
                model: "google/gemma-3-27b-it:free"
              }
            ]
          }
        }
      }
    });
  });

  it("exposes runtime fallback candidates for explicit model ids when enabled", async () => {
    const runtimeFallbackApp = buildApp({
      env: {
        ENABLE_EXPLICIT_MODEL_RUNTIME_FALLBACK: true
      },
      services: {
        catalogRepository: repository,
        catalogSyncService: null,
        executionClient: null
      }
    });

    const response = await runtimeFallbackApp.inject({
      method: "POST",
      url: "/v1/route/debug",
      payload: {
        model: "openai/gpt-oss-120b:free",
        messages: [
          {
            role: "user",
            content: "Reply with one short sentence."
          }
        ]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      direct: {
        ok: true,
        route: {
          selected_model: "openai/gpt-oss-120b:free",
          runtime_fallback: {
            trigger: "explicit_model_runtime_failure",
            selected_model: "google/gemma-3-27b-it:free"
          }
        }
      }
    });

    await runtimeFallbackApp.close();
  });
});
