import { describe, expect, it } from "vitest";

import type { CatalogModel } from "../../../src/modules/catalog/catalogTypes.js";
import {
  buildVisionReasoningRouteRequest,
  orchestrateVisionRequest,
  shouldPreferVisionOrchestration
} from "../../../src/modules/orchestration/orchestrateVisionRequest.js";
import type { NormalizedRouteRequest } from "../../../src/modules/routing/requestAnalyzer.js";
import type { DirectRoutePlan } from "../../../src/modules/routing/routingTypes.js";

describe("orchestrateVisionRequest", () => {
  it("builds a vision preprocessing plan when the reasoning model lacks image support", () => {
    const result = orchestrateVisionRequest({
      request: {
        model: "auto:free",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Read this invoice and extract the total."
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
      },
      routeRequest: {
        task_type: "document_extraction",
        required_modalities: ["text", "image"],
        required_features: [],
        preferred_context_length: 32000,
        allow_paid_fallback: false,
        debug: false
      },
      reasoningPlan: createReasoningPlan(),
      models: [
        createModel("qwen/qwen3-coder:free", {
          input_modalities: ["text"]
        }),
        createModel("google/gemma-3-27b-it:free", {
          input_modalities: ["text", "image"],
          is_free_image: true
        })
      ]
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.plan).toMatchObject({
      mode: "orchestrated",
      reasoning_model: "qwen/qwen3-coder:free",
      preprocessors: [
        {
          type: "vision",
          model: "google/gemma-3-27b-it:free",
          output_contract: "vision_intermediate_v1"
        }
      ]
    });
    expect(result.plan.preprocessors[0].prompt.user).toContain("Read this invoice");
  });

  it("returns a capability_unavailable error when no vision model is eligible", () => {
    const result = orchestrateVisionRequest({
      request: {
        model: "auto:free",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Describe this image."
              },
              {
                type: "image_url",
                image_url: {
                  url: "https://example.com/image.png"
                }
              }
            ]
          }
        ]
      },
      routeRequest: {
        task_type: "vision_qa",
        required_modalities: ["text", "image"],
        required_features: [],
        preferred_context_length: 32000,
        allow_paid_fallback: false,
        debug: false
      },
      reasoningPlan: createReasoningPlan(),
      models: [
        createModel("qwen/qwen3-coder:free", {
          input_modalities: ["text"]
        })
      ]
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "capability_unavailable"
      })
    });
  });

  it("prefers orchestration for reasoning alias and explicit model ids, but not auto:free", () => {
    const imageRequest: NormalizedRouteRequest = {
      task_type: "vision_qa",
      required_modalities: ["text", "image"],
      required_features: [],
      preferred_context_length: 32000,
      allow_paid_fallback: false,
      debug: false
    };

    expect(shouldPreferVisionOrchestration("auto:reasoning", imageRequest)).toBe(true);
    expect(shouldPreferVisionOrchestration("openai/gpt-oss-120b:free", imageRequest)).toBe(true);
    expect(shouldPreferVisionOrchestration("auto:free", imageRequest)).toBe(false);
  });

  it("builds a text-only reasoning request for image tasks", () => {
    expect(buildVisionReasoningRouteRequest("auto:reasoning", {
      task_type: "document_extraction",
      required_modalities: ["text", "image"],
      required_features: [],
      preferred_context_length: 32000,
      allow_paid_fallback: false,
      debug: false
    })).toEqual({
      task_type: "reasoning",
      required_modalities: ["text"],
      required_features: [],
      preferred_context_length: 32000,
      allow_paid_fallback: false,
      debug: false
    });
  });
});

function createReasoningPlan(): DirectRoutePlan {
  return {
    mode: "direct",
    requested_model: "auto:free",
    resolved_model: {
      requested_model: "auto:free",
      requested_alias: "auto:free",
      prefer_free: true,
      required_modalities: ["text", "image"]
    },
    normalized_request: {
      task_type: "document_extraction",
      required_modalities: ["text", "image"],
      required_features: [],
      preferred_context_length: 32000,
      allow_paid_fallback: false,
      debug: false
    },
    selected_model: "qwen/qwen3-coder:free",
    fallback_chain: [],
    reasons: ["selected the highest-scoring eligible candidate for direct execution"],
    ranked_candidates: []
  };
}

function createModel(modelId: string, overrides: Partial<CatalogModel> = {}): CatalogModel {
  return {
    model_id: modelId,
    display_name: modelId,
    input_modalities: ["text"],
    output_modalities: ["text"],
    context_length: 64000,
    supported_parameters: [],
    pricing: {
      prompt: "0",
      completion: "0",
      image: "0"
    },
    is_active: true,
    is_free_text: true,
    is_free_image: true,
    provider_endpoints: [],
    health: {
      uptime_score: 0.9,
      latency_score: 0.85,
      throughput_score: 0.82,
      recent_success_score: 0.88
    },
    last_seen_at: "2026-03-13T09:00:00.000Z",
    ...overrides
  };
}
