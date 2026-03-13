import { afterAll, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app/buildApp.js";
import { InMemoryCatalogRepository } from "../../src/modules/catalog/catalogRepository.js";

describe("chat completions route errors", () => {
  it("returns a stable no_eligible_model error with debug route context", async () => {
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
      url: "/v1/chat/completions?debug=1",
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
    expect(response.json()).toMatchObject({
      error: {
        message: "No eligible model matched the current routing policy.",
        type: "api_error",
        code: "no_eligible_model"
      },
      route: {
        mode: "unavailable",
        error_code: "no_eligible_model",
        requested_model: "auto:free"
      }
    });

    await app.close();
  });

  it("maps upstream executor failures to stable upstream_unavailable responses", async () => {
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
            uptime_score: 0.9,
            latency_score: 0.86,
            throughput_score: 0.83,
            recent_success_score: 0.88
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
          async executeChatCompletion() {
            throw new Error("temporary upstream failure");
          }
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions?debug=1",
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
    expect(response.json()).toMatchObject({
      error: {
        code: "upstream_unavailable",
        message: "temporary upstream failure"
      },
      route: {
        mode: "direct",
        selected_model: "qwen/qwen3-coder:free"
      }
    });

    await app.close();
  });
});

afterAll(async () => {
  // placeholder to keep room for shared fixtures
});
