import { afterAll, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app/buildApp.js";
import { InMemoryCatalogRepository } from "../../src/modules/catalog/catalogRepository.js";

describe("GET /v1/capabilities", () => {
  it("returns capability summary from the current catalog snapshot", async () => {
    const repository = new InMemoryCatalogRepository();
    await repository.replaceSnapshot({
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
            latency_score: 0.85,
            throughput_score: 0.82,
            recent_success_score: 0.88
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
            recent_success_score: 0.87
          },
          last_seen_at: "2026-03-13T09:00:00.000Z"
        },
        {
          model_id: "openai/whisper-mini:free",
          display_name: "Whisper Mini",
          input_modalities: ["text", "audio"],
          output_modalities: ["text"],
          context_length: 64000,
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
            uptime_score: 0.8,
            latency_score: 0.76,
            throughput_score: 0.74,
            recent_success_score: 0.79
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

    const response = await app.inject({
      method: "GET",
      url: "/v1/capabilities"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      object: "easyapi.capabilities",
      catalog: {
        available: true,
        source: "openrouter",
        version: 1,
        synced_at: "2026-03-13T09:00:00.000Z",
        model_count: 3,
        active_model_count: 3
      },
      aliases: expect.arrayContaining([
        expect.objectContaining({
          id: "auto",
          available: true
        }),
        expect.objectContaining({
          id: "auto:vision",
          available: true,
          selected_model: "google/gemma-3-27b-it:free"
        })
      ]),
      modalities: {
        text: {
          available: true,
          active_model_count: 3,
          free_model_count: 3
        },
        image: {
          available: true,
          active_model_count: 1,
          free_model_count: 1
        },
        audio: {
          available: true,
          active_model_count: 1
        }
      },
      features: {
        streaming: {
          available: true,
          gateway_managed: true,
          direct_model_count: 3
        },
        tools: {
          available: true,
          active_model_count: 1
        },
        response_format: {
          available: true,
          active_model_count: 1
        }
      },
      orchestration: {
        vision: {
          available: true,
          preprocessor_model_count: 1
        },
        audio: {
          available: true,
          preprocessor_model_count: 1
        }
      },
      health: {
        healthy_model_count: 3,
        average_scores: {
          uptime_score: 0.8633,
          latency_score: 0.8167,
          throughput_score: 0.79,
          recent_success_score: 0.8467
        },
        floor_range: {
          min: 0.74,
          max: 0.82
        }
      }
    });

    await app.close();
  });

  it("returns a degraded but stable summary when no catalog snapshot is available", async () => {
    const app = buildApp({
      services: {
        catalogRepository: new InMemoryCatalogRepository(),
        catalogSyncService: null,
        executionClient: null
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/capabilities"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      object: "easyapi.capabilities",
      catalog: {
        available: false,
        model_count: 0,
        active_model_count: 0
      },
      modalities: {
        text: {
          available: false,
          active_model_count: 0,
          free_model_count: 0
        },
        image: {
          available: false,
          active_model_count: 0,
          free_model_count: 0
        },
        audio: {
          available: false,
          active_model_count: 0
        }
      },
      features: {
        streaming: {
          available: false,
          gateway_managed: true,
          direct_model_count: 0
        },
        tools: {
          available: false,
          active_model_count: 0
        },
        response_format: {
          available: false,
          active_model_count: 0
        }
      }
    });

    await app.close();
  });
});

afterAll(async () => {
  // no-op safeguard for future shared fixtures
});
