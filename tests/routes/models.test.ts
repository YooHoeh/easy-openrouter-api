import { afterAll, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app/buildApp.js";
import { InMemoryCatalogRepository } from "../../src/modules/catalog/catalogRepository.js";

describe("GET /v1/models", () => {
  const repository = new InMemoryCatalogRepository();
  repository.replaceSnapshot({
    source: "openrouter",
    version: 1,
    synced_at: "2026-03-13T09:00:00.000Z",
    models: [
      {
        model_id: "qwen/qwen3-coder:free",
        display_name: "Qwen 3 Coder",
        created_at: 1773390000,
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
          latency_score: 0.85,
          throughput_score: 0.82,
          recent_success_score: 0.88
        },
        last_seen_at: "2026-03-13T09:00:00.000Z"
      },
      {
        model_id: "google/gemma-3-27b-it:free",
        display_name: "Gemma Vision",
        created_at: 1773390100,
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
        model_id: "openai/gpt-oss-120b:free",
        display_name: "GPT OSS 120B",
        created_at: 1773390200,
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
          uptime_score: 0.88,
          latency_score: 0.83,
          throughput_score: 0.8,
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

  it("returns the stable aliases plus current recommended models", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/models"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      object: "list",
      data: [
        {
          id: "auto",
          object: "model",
          created: 1773300000,
          owned_by: "easy-api"
        },
        {
          id: "auto:free",
          object: "model",
          created: 1773300000,
          owned_by: "easy-api"
        },
        {
          id: "auto:vision",
          object: "model",
          created: 1773300000,
          owned_by: "easy-api"
        },
        {
          id: "auto:coding",
          object: "model",
          created: 1773300000,
          owned_by: "easy-api"
        },
        {
          id: "auto:reasoning",
          object: "model",
          created: 1773300000,
          owned_by: "easy-api"
        },
        {
          id: "openai/gpt-oss-120b:free",
          object: "model",
          created: 1773390200,
          owned_by: "openai"
        },
        {
          id: "google/gemma-3-27b-it:free",
          object: "model",
          created: 1773390100,
          owned_by: "google"
        },
        {
          id: "qwen/qwen3-coder:free",
          object: "model",
          created: 1773390000,
          owned_by: "qwen"
        }
      ]
    });
  });

  it("returns current auto alias resolutions", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/models/auto"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      object: "easyapi.auto_models",
      catalog: {
        available: true,
        source: "openrouter",
        version: 1,
        synced_at: "2026-03-13T09:00:00.000Z",
        model_count: 3
      },
      data: [
        {
          id: "auto",
          object: "easyapi.auto_model",
          available: true,
          selected_model: "openai/gpt-oss-120b:free",
          required_modalities: ["text"],
          required_features: []
        },
        {
          id: "auto:free",
          object: "easyapi.auto_model",
          available: true,
          selected_model: "openai/gpt-oss-120b:free",
          required_modalities: ["text"],
          required_features: []
        },
        {
          id: "auto:vision",
          object: "easyapi.auto_model",
          available: true,
          selected_model: "google/gemma-3-27b-it:free",
          required_modalities: ["text", "image"],
          required_features: []
        },
        {
          id: "auto:coding",
          object: "easyapi.auto_model",
          available: true,
          selected_model: "qwen/qwen3-coder:free",
          required_modalities: ["text"],
          required_features: []
        },
        {
          id: "auto:reasoning",
          object: "easyapi.auto_model",
          available: true,
          selected_model: "openai/gpt-oss-120b:free",
          required_modalities: ["text"],
          required_features: []
        }
      ]
    });
  });
});
