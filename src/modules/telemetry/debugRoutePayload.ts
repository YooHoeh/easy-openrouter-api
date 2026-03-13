import type { VisionOrchestrationPlan } from "../orchestration/intermediateContracts.js";
import type { NormalizedRouteRequest } from "../routing/requestAnalyzer.js";
import type { DirectRoutePlan, RoutePlanError } from "../routing/routingTypes.js";

export function buildRouteDebugPayload(
  routePlan: DirectRoutePlan,
  options: {
    actualModel?: string;
    attemptedModels?: string[];
    fallbackUsed?: boolean;
    runtimeFallbackUsed?: boolean;
  } = {}
) {
  return {
    mode: routePlan.mode,
    requested_model: routePlan.requested_model,
    selected_model: routePlan.selected_model,
    ...(options.actualModel ? { actual_model: options.actualModel } : {}),
    fallback_chain: routePlan.fallback_chain,
    ...(options.attemptedModels ? { attempted_models: options.attemptedModels } : {}),
    fallback_used: options.fallbackUsed ?? false,
    runtime_fallback_used: options.runtimeFallbackUsed ?? false,
    ...(routePlan.runtime_fallback
      ? {
          runtime_fallback: routePlan.runtime_fallback
        }
      : {}),
    normalized_request: routePlan.normalized_request,
    resolved_model: routePlan.resolved_model,
    reasons: routePlan.reasons,
    ranked_candidates: routePlan.ranked_candidates
  };
}

export function buildRouteErrorDebugPayload(
  error: RoutePlanError | { requested_model: string; reasons: string[]; normalized_request?: unknown; resolved_model?: unknown },
  options: {
    code: string;
    mode?: string;
    selectedModel?: string;
    fallbackChain?: string[];
    runtimeFallback?: DirectRoutePlan["runtime_fallback"];
  } = {
    code: "upstream_unavailable"
  }
) {
  return {
    mode: options.mode ?? "unavailable",
    error_code: options.code,
    requested_model: error.requested_model,
    ...(options.selectedModel ? { selected_model: options.selectedModel } : {}),
    ...(options.fallbackChain ? { fallback_chain: options.fallbackChain } : {}),
    ...(options.runtimeFallback ? { runtime_fallback: options.runtimeFallback } : {}),
    ...("normalized_request" in error && error.normalized_request
      ? { normalized_request: error.normalized_request }
      : {}),
    ...("resolved_model" in error && error.resolved_model ? { resolved_model: error.resolved_model } : {}),
    reasons: error.reasons
  };
}

export function buildVisionOrchestrationDebugPayload(
  input: {
    requestedModel: string;
    normalizedRequest: NormalizedRouteRequest;
    reasoningPlan: DirectRoutePlan;
    plan: VisionOrchestrationPlan;
  },
  options: {
    reasoning?: {
      actualModel?: string;
      attemptedModels?: string[];
      fallbackUsed?: boolean;
      runtimeFallbackUsed?: boolean;
    };
    preprocessors?: Array<{
      actualModel?: string;
      attemptedModels?: string[];
      fallbackUsed?: boolean;
      runtimeFallbackUsed?: boolean;
    }>;
  } = {}
) {
  return {
    mode: input.plan.mode,
    requested_model: input.requestedModel,
    normalized_request: input.normalizedRequest,
    selected_preprocessors: input.plan.preprocessors.map((preprocessor) => preprocessor.model),
    reasoning_route: buildRouteDebugPayload(input.reasoningPlan, options.reasoning),
    preprocessors: input.plan.preprocessors.map((preprocessor, index) => ({
      type: preprocessor.type,
      selected_model: preprocessor.model,
      fallback_chain: preprocessor.fallback_chain,
      output_contract: preprocessor.output_contract,
      ...(options.preprocessors?.[index]?.actualModel
        ? { actual_model: options.preprocessors[index]?.actualModel }
        : {}),
      ...(options.preprocessors?.[index]?.attemptedModels
        ? { attempted_models: options.preprocessors[index]?.attemptedModels }
        : {}),
      fallback_used: options.preprocessors?.[index]?.fallbackUsed ?? false,
      runtime_fallback_used: options.preprocessors?.[index]?.runtimeFallbackUsed ?? false
    })),
    plan: input.plan
  };
}
