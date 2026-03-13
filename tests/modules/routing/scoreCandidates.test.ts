import { describe, expect, it } from "vitest";

import type { CatalogModel } from "../../../src/modules/catalog/catalogTypes.js";
import { scoreCandidates } from "../../../src/modules/routing/scoreCandidates.js";

describe("scoreCandidates", () => {
  it("ranks coding-oriented models ahead of generic models for coding tasks", () => {
    const candidates = [
      createModel("generic/free-model", {
        health: {
          uptime_score: 0.95,
          latency_score: 0.9,
          throughput_score: 0.9,
          recent_success_score: 0.9
        },
        supported_parameters: ["tools"]
      }),
      createModel("qwen/qwen3-coder:free", {
        health: {
          uptime_score: 0.9,
          latency_score: 0.85,
          throughput_score: 0.82,
          recent_success_score: 0.88
        },
        context_length: 128000,
        supported_parameters: ["tools", "response_format"]
      })
    ];

    const ranked = scoreCandidates(candidates, {
      task_type: "coding",
      required_modalities: ["text"],
      required_features: ["tools"],
      preferred_context_length: 16000,
      allow_paid_fallback: false,
      debug: false
    });

    expect(ranked[0]?.model.model_id).toBe("qwen/qwen3-coder:free");
    expect(ranked[0]?.breakdown.task_prior_score).toBeGreaterThan(ranked[1]?.breakdown.task_prior_score ?? 0);
    expect(ranked[0]?.final_score).toBeGreaterThan(ranked[1]?.final_score ?? 0);
  });

  it("uses a deterministic model id tie-breaker when scores are equal", () => {
    const ranked = scoreCandidates(
      [
        createModel("b-model"),
        createModel("a-model")
      ],
      {
        task_type: "general_chat",
        required_modalities: ["text"],
        required_features: [],
        preferred_context_length: 16000,
        allow_paid_fallback: false,
        debug: false
      }
    );

    expect(ranked.map((candidate) => candidate.model.model_id)).toEqual(["a-model", "b-model"]);
  });

  it("prefers instruction-following free chat models over loosely aligned dolphin variants", () => {
    const candidates = [
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
    ];

    const ranked = scoreCandidates(candidates, {
      task_type: "general_chat",
      required_modalities: ["text"],
      required_features: [],
      preferred_context_length: 16000,
      allow_paid_fallback: false,
      debug: false
    });

    expect(ranked[0]?.model.model_id).toBe("openai/gpt-oss-120b:free");
    expect(ranked[0]?.breakdown.task_prior_score).toBeGreaterThan(ranked[1]?.breakdown.task_prior_score ?? 0);
    expect(ranked[0]?.final_score).toBeGreaterThan(ranked[1]?.final_score ?? 0);
  });

  it("pushes generic trinity-style fallbacks behind stronger instruct chat models", () => {
    const candidates = [
      createModel("arcee-ai/trinity-large-preview:free", {
        display_name: "Trinity Large Preview",
        health: {
          uptime_score: 0.95,
          latency_score: 0.9,
          throughput_score: 0.9,
          recent_success_score: 0.91
        }
      }),
      createModel("meta-llama/llama-3.3-70b-instruct:free", {
        display_name: "Llama 3.3 70B Instruct",
        health: {
          uptime_score: 0.82,
          latency_score: 0.78,
          throughput_score: 0.77,
          recent_success_score: 0.8
        }
      })
    ];

    const ranked = scoreCandidates(candidates, {
      task_type: "general_chat",
      required_modalities: ["text"],
      required_features: [],
      preferred_context_length: 16000,
      allow_paid_fallback: false,
      debug: false
    });

    expect(ranked[0]?.model.model_id).toBe("meta-llama/llama-3.3-70b-instruct:free");
    expect(ranked[0]?.breakdown.task_prior_score).toBeGreaterThan(ranked[1]?.breakdown.task_prior_score ?? 0);
  });

  it("does not promote coder-focused models for plain general chat", () => {
    const candidates = [
      createModel("qwen/qwen3-coder:free", {
        display_name: "Qwen 3 Coder",
        health: {
          uptime_score: 0.95,
          latency_score: 0.9,
          throughput_score: 0.89,
          recent_success_score: 0.9
        }
      }),
      createModel("meta-llama/llama-3.3-70b-instruct:free", {
        display_name: "Llama 3.3 70B Instruct",
        health: {
          uptime_score: 0.82,
          latency_score: 0.78,
          throughput_score: 0.77,
          recent_success_score: 0.8
        }
      })
    ];

    const ranked = scoreCandidates(candidates, {
      task_type: "general_chat",
      required_modalities: ["text"],
      required_features: [],
      preferred_context_length: 16000,
      allow_paid_fallback: false,
      debug: false
    });

    expect(ranked[0]?.model.model_id).toBe("meta-llama/llama-3.3-70b-instruct:free");
    expect(ranked[0]?.breakdown.task_prior_score).toBeGreaterThan(ranked[1]?.breakdown.task_prior_score ?? 0);
  });

  it("prefers lower-latency chat models for simple streaming general chat", () => {
    const candidates = [
      createModel("openai/gpt-oss-120b:free", {
        display_name: "GPT OSS 120B",
        health: {
          uptime_score: 0.9,
          latency_score: 0.82,
          throughput_score: 0.82,
          recent_success_score: 0.88
        }
      }),
      createModel("stepfun/step-3.5-flash:free", {
        display_name: "Step 3.5 Flash",
        health: {
          uptime_score: 0.9,
          latency_score: 0.88,
          throughput_score: 0.86,
          recent_success_score: 0.89
        }
      }),
      createModel("z-ai/glm-4.5-air:free", {
        display_name: "GLM 4.5 Air",
        health: {
          uptime_score: 0.89,
          latency_score: 0.87,
          throughput_score: 0.85,
          recent_success_score: 0.88
        }
      })
    ];

    const ranked = scoreCandidates(candidates, {
      task_type: "general_chat",
      required_modalities: ["text"],
      required_features: ["streaming"],
      preferred_context_length: 16000,
      allow_paid_fallback: false,
      debug: false
    });

    expect(ranked[0]?.model.model_id).toBe("stepfun/step-3.5-flash:free");
    expect(ranked[1]?.model.model_id).toBe("z-ai/glm-4.5-air:free");
    expect(ranked[2]?.model.model_id).toBe("openai/gpt-oss-120b:free");
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
