import { describe, expect, it } from "vitest";

import type { CatalogModel } from "../../../src/modules/catalog/catalogTypes.js";
import { filterCandidates } from "../../../src/modules/routing/filterCandidates.js";

describe("filterCandidates", () => {
  it("keeps only free text-capable candidates that satisfy tools and context", () => {
    const result = filterCandidates(
      [
        createModel("qwen/qwen3-coder:free", {
          supported_parameters: ["tools", "response_format"],
          context_length: 128000
        }),
        createModel("small/free-model", {
          supported_parameters: ["tools"],
          context_length: 8000
        }),
        createModel("paid/strong-model", {
          is_free_text: false,
          context_length: 128000,
          supported_parameters: ["tools", "response_format"]
        })
      ],
      {
        task_type: "coding",
        required_modalities: ["text"],
        required_features: ["tools"],
        preferred_context_length: 16000,
        allow_paid_fallback: false,
        debug: false
      },
      "auto:free"
    );

    expect(result.resolved_model.prefer_free).toBe(true);
    expect(result.candidates.map((model) => model.model_id)).toEqual(["qwen/qwen3-coder:free"]);
  });

  it("upgrades the required modalities for the auto vision alias", () => {
    const result = filterCandidates(
      [
        createModel("vision/free-model", {
          input_modalities: ["text", "image"],
          context_length: 64000
        }),
        createModel("text/free-model", {
          input_modalities: ["text"],
          context_length: 64000
        })
      ],
      {
        task_type: "general_chat",
        required_modalities: ["text"],
        required_features: [],
        preferred_context_length: 16000,
        allow_paid_fallback: false,
        debug: false
      },
      "auto:vision"
    );

    expect(result.resolved_model.required_modalities).toEqual(["text", "image"]);
    expect(result.candidates.map((model) => model.model_id)).toEqual(["vision/free-model"]);
  });

  it("accepts structured outputs as a response format capability", () => {
    const result = filterCandidates(
      [
        createModel("structured/free-model", {
          supported_parameters: ["structured_outputs"],
          context_length: 64000
        }),
        createModel("plain/free-model", {
          supported_parameters: ["temperature"],
          context_length: 64000
        })
      ],
      {
        task_type: "reasoning",
        required_modalities: ["text"],
        required_features: ["response_format"],
        preferred_context_length: 16000,
        allow_paid_fallback: false,
        debug: false
      },
      "auto"
    );

    expect(result.candidates.map((model) => model.model_id)).toEqual(["structured/free-model"]);
  });
});

function createModel(modelId: string, overrides: Partial<CatalogModel> = {}): CatalogModel {
  return {
    model_id: modelId,
    display_name: modelId,
    input_modalities: ["text"],
    output_modalities: ["text"],
    context_length: 32000,
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
      latency_score: 0.8,
      throughput_score: 0.8,
      recent_success_score: 0.8
    },
    last_seen_at: "2026-03-13T09:00:00.000Z",
    ...overrides
  };
}
