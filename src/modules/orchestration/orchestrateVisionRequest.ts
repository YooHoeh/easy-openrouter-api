import type { CatalogModel } from "../catalog/catalogTypes.js";
import { buildRoutePlan } from "../routing/buildRoutePlan.js";
import { isStableModelAlias } from "../routing/modelAliases.js";
import type { ParsedChatCompletionsRequest } from "../routing/requestSchemas.js";
import type { NormalizedRouteRequest } from "../routing/requestAnalyzer.js";
import type { DirectRoutePlan } from "../routing/routingTypes.js";
import type { VisionOrchestrationPlan } from "./intermediateContracts.js";
import {
  buildVisionExtractionSystemPrompt,
  buildVisionExtractionUserPrompt
} from "./visionPromptTemplates.js";

export type VisionOrchestrationResult =
  | {
      ok: true;
      plan: VisionOrchestrationPlan;
    }
  | {
      ok: false;
      error: {
        code: "capability_unavailable";
        message: string;
        reasons: string[];
      };
    };

export interface OrchestrateVisionRequestInput {
  request: ParsedChatCompletionsRequest;
  routeRequest: NormalizedRouteRequest;
  reasoningPlan: DirectRoutePlan;
  models: CatalogModel[];
}

export function shouldPreferVisionOrchestration(
  requestedModel: string,
  routeRequest: NormalizedRouteRequest
) {
  if (!routeRequest.required_modalities.includes("image")) {
    return false;
  }

  if (!isStableModelAlias(requestedModel)) {
    return true;
  }

  return requestedModel === "auto:reasoning" || requestedModel === "auto:coding";
}

export function buildVisionReasoningRouteRequest(
  requestedModel: string,
  routeRequest: NormalizedRouteRequest
): NormalizedRouteRequest {
  return {
    ...routeRequest,
    task_type: inferReasoningTaskType(requestedModel, routeRequest.task_type),
    required_modalities: routeRequest.required_modalities.filter((modality) => modality !== "image")
  };
}

export function orchestrateVisionRequest(
  input: OrchestrateVisionRequestInput
): VisionOrchestrationResult {
  if (!input.routeRequest.required_modalities.includes("image")) {
    return {
      ok: false,
      error: {
        code: "capability_unavailable",
        message: "Vision orchestration only applies to image-aware requests.",
        reasons: ["request did not require image input"]
      }
    };
  }

  const reasoningModel = input.models.find((model) => model.model_id === input.reasoningPlan.selected_model);

  if (!reasoningModel) {
    return {
      ok: false,
      error: {
        code: "capability_unavailable",
        message: "The selected reasoning model could not be found in the catalog snapshot.",
        reasons: ["reasoning model metadata was missing from the current catalog"]
      }
    };
  }

  if (reasoningModel.input_modalities.includes("image")) {
    return {
      ok: false,
      error: {
        code: "capability_unavailable",
        message: "The selected reasoning model already supports direct image input.",
        reasons: ["vision preprocessing is not required for this route plan"]
      }
    };
  }

  const visionRouteRequest: NormalizedRouteRequest = {
    task_type: input.routeRequest.task_type === "document_extraction" ? "document_extraction" : "vision_qa",
    required_modalities: ["text", "image"],
    required_features: [],
    preferred_context_length: Math.max(input.routeRequest.preferred_context_length, 32000),
    allow_paid_fallback: input.routeRequest.allow_paid_fallback,
    debug: input.routeRequest.debug
  };
  const visionPlanResult = buildRoutePlan(input.models, visionRouteRequest, "auto:vision");

  if (!visionPlanResult.ok) {
    return {
      ok: false,
      error: {
        code: "capability_unavailable",
        message: "No eligible vision preprocessing model is available.",
        reasons: visionPlanResult.error.reasons
      }
    };
  }

  return {
    ok: true,
    plan: {
      mode: "orchestrated",
      reasoning_model: input.reasoningPlan.selected_model,
      preprocessors: [
        {
          type: "vision",
          model: visionPlanResult.plan.selected_model,
          fallback_chain: visionPlanResult.plan.fallback_chain,
          prompt: {
            system: buildVisionExtractionSystemPrompt(),
            user: buildVisionExtractionUserPrompt(input.request)
          },
          output_contract: "vision_intermediate_v1"
        }
      ],
      final_response_contract: {
        response_model: input.reasoningPlan.selected_model,
        intermediate_contract: "vision_intermediate_v1"
      }
    }
  };
}

function inferReasoningTaskType(
  requestedModel: string,
  originalTaskType: NormalizedRouteRequest["task_type"]
): NormalizedRouteRequest["task_type"] {
  if (requestedModel === "auto:coding") {
    return "coding";
  }

  if (requestedModel === "auto:reasoning") {
    return "reasoning";
  }

  if (originalTaskType === "document_extraction") {
    return "reasoning";
  }

  return "general_chat";
}
