import { describe, expect, it } from "vitest";

import type { CatalogModel } from "../../../src/modules/catalog/catalogTypes.js";
import { buildRoutePlan } from "../../../src/modules/routing/buildRoutePlan.js";

describe("buildRoutePlan", () => {
  it("selects the highest-scoring direct candidate and builds a fallback chain", () => {
    const result = buildRoutePlan(
      [
        createModel("generic/free-model", {
          supported_parameters: ["tools"],
          health: {
            uptime_score: 0.9,
            latency_score: 0.88,
            throughput_score: 0.87,
            recent_success_score: 0.89
          }
        }),
        createModel("qwen/qwen3-coder:free", {
          supported_parameters: ["tools", "response_format"],
          context_length: 128000,
          health: {
            uptime_score: 0.89,
            latency_score: 0.86,
            throughput_score: 0.83,
            recent_success_score: 0.88
          }
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
      "auto:coding"
    );

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.plan).toMatchObject({
      mode: "direct",
      requested_model: "auto:coding",
      selected_model: "qwen/qwen3-coder:free",
      fallback_chain: ["generic/free-model"]
    });
    expect(result.plan.ranked_candidates).toHaveLength(2);
    expect(result.plan.reasons).toContain(
      "selected the highest-scoring eligible candidate for direct execution"
    );
  });

  it("returns a stable no_eligible_model error when nothing matches", () => {
    const result = buildRoutePlan(
      [
        createModel("tiny/free-model", {
          context_length: 8000
        })
      ],
      {
        task_type: "reasoning",
        required_modalities: ["text", "image"],
        required_features: ["response_format"],
        preferred_context_length: 32000,
        allow_paid_fallback: false,
        debug: false
      },
      "auto:vision"
    );

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "no_eligible_model",
        requested_model: "auto:vision"
      })
    });
  });

  it("prefers stronger general-chat free models for auto:free requests", () => {
    const result = buildRoutePlan(
      [
        createModel("cognitivecomputations/dolphin-mistral-24b-venice-edition:free", {
          display_name: "Dolphin Mistral Venice",
          health: {
            uptime_score: 0.96,
            latency_score: 0.92,
            throughput_score: 0.92,
            recent_success_score: 0.93
          }
        }),
        createModel("openai/gpt-oss-120b:free", {
          display_name: "GPT OSS 120B",
          health: {
            uptime_score: 0.84,
            latency_score: 0.8,
            throughput_score: 0.78,
            recent_success_score: 0.82
          }
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
      "auto:free"
    );

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.plan.selected_model).toBe("openai/gpt-oss-120b:free");
    expect(result.plan.fallback_chain).toEqual([
      "cognitivecomputations/dolphin-mistral-24b-venice-edition:free"
    ]);
  });

  it("precomputes a runtime fallback chain for explicit model ids when enabled", () => {
    const result = buildRoutePlan(
      [
        createModel("openai/gpt-oss-120b:free", {
          display_name: "GPT OSS 120B",
          health: {
            uptime_score: 0.91,
            latency_score: 0.85,
            throughput_score: 0.82,
            recent_success_score: 0.88
          }
        }),
        createModel("qwen/qwen3-next-80b-a3b-instruct:free", {
          display_name: "Qwen 3 Next",
          context_length: 128000,
          health: {
            uptime_score: 0.95,
            latency_score: 0.9,
            throughput_score: 0.88,
            recent_success_score: 0.93
          }
        }),
        createModel("google/gemma-3-27b-it:free", {
          display_name: "Gemma 3",
          context_length: 128000,
          health: {
            uptime_score: 0.89,
            latency_score: 0.86,
            throughput_score: 0.84,
            recent_success_score: 0.87
          }
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
      "openai/gpt-oss-120b:free",
      {
        enableExplicitModelRuntimeFallback: true
      }
    );

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.plan.selected_model).toBe("openai/gpt-oss-120b:free");
    expect(result.plan.runtime_fallback).toMatchObject({
      trigger: "explicit_model_runtime_failure",
      selected_model: "qwen/qwen3-next-80b-a3b-instruct:free",
      fallback_chain: ["google/gemma-3-27b-it:free"]
    });
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
