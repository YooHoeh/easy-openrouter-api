import { describe, expect, it } from "vitest";

import { InMemoryCatalogRepository } from "../../../src/modules/catalog/catalogRepository.js";
import { CatalogSyncService } from "../../../src/modules/catalog/catalogSync.js";
import { OpenRouterClient } from "../../../src/modules/catalog/openrouterClient.js";

describe("OpenRouterClient", () => {
  it("fetches and validates the models payload", async () => {
    const client = new OpenRouterClient({
      fetch: async () => ({
        ok: true,
        status: 200,
        async json() {
          return {
            data: [
              {
                id: "qwen/qwen3-coder:free",
                name: "Qwen 3 Coder",
                description: null,
                architecture: {
                  input_modalities: ["text"],
                  output_modalities: ["text"]
                },
                top_provider: {
                  context_length: null,
                  max_completion_tokens: null,
                  is_moderated: null
                },
                pricing: {
                  prompt: "0",
                  completion: "0"
                }
              }
            ]
          };
        }
      })
    });

    await expect(client.fetchModels()).resolves.toEqual([
      expect.objectContaining({
        id: "qwen/qwen3-coder:free",
        name: "Qwen 3 Coder"
      })
    ]);
  });
});

describe("CatalogSyncService", () => {
  it("normalizes models into a sorted snapshot and increments the version", async () => {
    let upstreamModels = [
      {
        id: "z/model-b:free",
        name: "Model B",
        architecture: {
          input_modalities: ["text", "image"],
          output_modalities: ["text"]
        },
        pricing: {
          prompt: "0",
          completion: "0",
          image: "0"
        },
        top_provider: {
          context_length: 128000,
          max_completion_tokens: 16384
        },
        supported_parameters: ["tools", "response_format"]
      },
      {
        id: "a/model-a",
        name: "Model A",
        architecture: {
          input_modalities: ["text"]
        },
        pricing: {
          prompt: "0.000001",
          completion: "0.000002"
        },
        context_length: 32000,
        supported_parameters: ["temperature"]
      }
    ];

    const repository = new InMemoryCatalogRepository();
    const service = new CatalogSyncService(
      {
        async fetchModels() {
          return upstreamModels;
        }
      },
      repository,
      {
        now: () => new Date("2026-03-13T09:00:00.000Z")
      }
    );

    const firstSnapshot = await service.sync();

    expect(firstSnapshot).toMatchObject({
      source: "openrouter",
      version: 1,
      synced_at: "2026-03-13T09:00:00.000Z"
    });
    expect(firstSnapshot.models.map((model) => model.model_id)).toEqual([
      "a/model-a",
      "z/model-b:free"
    ]);
    expect(firstSnapshot.models[1]).toMatchObject({
      model_id: "z/model-b:free",
      input_modalities: ["text", "image"],
      supported_parameters: ["response_format", "tools"],
      is_free_text: true,
      is_free_image: true,
      context_length: 128000,
      max_completion_tokens: 16384,
      provider_endpoints: [
        {
          name: "top_provider",
          provider_name: "top_provider"
        }
      ]
    });

    upstreamModels = upstreamModels.slice(0, 1);
    const secondSnapshot = await service.sync();

    expect(secondSnapshot.version).toBe(2);
    await expect(repository.getSnapshot()).resolves.toEqual(secondSnapshot);
  });
});
