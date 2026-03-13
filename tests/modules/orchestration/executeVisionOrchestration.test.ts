import { describe, expect, it } from "vitest";

import {
  executeVisionOrchestration,
  prepareVisionOrchestration
} from "../../../src/modules/orchestration/executeVisionOrchestration.js";
import type { CatalogModel } from "../../../src/modules/catalog/catalogTypes.js";

describe("executeVisionOrchestration", () => {
  it("runs the vision preprocessor before the final reasoning request", async () => {
    const requests: Array<{ model: string; messages: unknown[] }> = [];
    const preparedResult = prepareVisionOrchestration({
      request: {
        model: "auto:reasoning",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Read this invoice image and explain the amount due."
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
        debug: true
      },
      enableExplicitModelRuntimeFallback: false,
      models: [
        createModel("openai/gpt-oss-120b:free", {
          input_modalities: ["text"]
        }),
        createModel("google/gemma-3-27b-it:free", {
          input_modalities: ["text", "image"],
          is_free_image: true
        })
      ]
    });

    expect(preparedResult.ok).toBe(true);

    if (!preparedResult.ok) {
      return;
    }

    const execution = await executeVisionOrchestration({
      request: {
        model: "auto:reasoning",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Read this invoice image and explain the amount due."
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
      prepared: preparedResult.prepared,
      executionClient: {
        async executeChatCompletion({ request, routePlan }) {
          requests.push({
            model: routePlan.requested_model,
            messages: request.messages
          });

          if (routePlan.requested_model === "auto:vision") {
            return {
              actualModel: routePlan.selected_model,
              attemptedModels: [routePlan.selected_model],
              fallbackUsed: false,
              response: {
                id: "chatcmpl_vision",
                object: "chat.completion",
                created: 1773392001,
                model: "auto:vision",
                choices: [
                  {
                    index: 0,
                    message: {
                      role: "assistant",
                      content: JSON.stringify({
                        source_type: "image",
                        summary: "Invoice total is 42 USD.",
                        raw_text: "TOTAL 42",
                        entities: [
                          {
                            type: "total",
                            value: "42 USD",
                            confidence: 0.93
                          }
                        ],
                        uncertainties: [],
                        confidence: 0.93
                      })
                    },
                    finish_reason: "stop"
                  }
                ],
                usage: {
                  prompt_tokens: 10,
                  completion_tokens: 8,
                  total_tokens: 18
                }
              }
            };
          }

          return {
            actualModel: routePlan.selected_model,
            attemptedModels: [routePlan.selected_model],
            fallbackUsed: false,
            response: {
              id: "chatcmpl_reasoning",
              object: "chat.completion",
              created: 1773392002,
              model: "auto:reasoning",
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: "The amount due is 42 USD."
                  },
                  finish_reason: "stop"
                }
              ],
              usage: {
                prompt_tokens: 12,
                completion_tokens: 6,
                total_tokens: 18
              }
            }
          };
        }
      }
    });

    expect(execution.selectedPreprocessors).toEqual(["google/gemma-3-27b-it:free"]);
    expect(execution.preprocessorExecutions[0]).toMatchObject({
      selectedModel: "google/gemma-3-27b-it:free",
      actualModel: "google/gemma-3-27b-it:free"
    });
    expect(execution.actualModel).toBe("openai/gpt-oss-120b:free");
    expect(execution.reasoningAttemptedModels).toEqual(["openai/gpt-oss-120b:free"]);
    expect(execution.response.choices[0]?.message.content).toBe("The amount due is 42 USD.");
    expect(requests).toHaveLength(2);
    expect(requests[0]?.model).toBe("auto:vision");
    expect(JSON.stringify(requests[0]?.messages)).toContain("https://example.com/invoice.png");
    expect(requests[1]?.model).toBe("auto:reasoning");
    expect(JSON.stringify(requests[1]?.messages)).toContain("Invoice total is 42 USD.");
    expect(JSON.stringify(requests[1]?.messages)).not.toContain("\"type\":\"image_url\"");
  });
});

function createModel(modelId: string, overrides: Partial<CatalogModel> = {}): CatalogModel {
  return {
    model_id: modelId,
    display_name: modelId,
    input_modalities: ["text"],
    output_modalities: ["text"],
    context_length: 128000,
    supported_parameters: [],
    pricing: {
      prompt: "0",
      completion: "0",
      image: "0"
    },
    is_active: true,
    is_free_text: true,
    is_free_image: false,
    provider_endpoints: [],
    health: {
      uptime_score: 0.9,
      latency_score: 0.85,
      throughput_score: 0.84,
      recent_success_score: 0.88
    },
    last_seen_at: "2026-03-13T09:00:00.000Z",
    ...overrides
  };
}
