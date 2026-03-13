import type { CatalogModel } from "../catalog/catalogTypes.js";
import { resolveModelAlias } from "./modelAliases.js";
import type { NormalizedRouteRequest } from "./requestAnalyzer.js";
import { filterCandidates, type FilterCandidatesOptions } from "./filterCandidates.js";
import { scoreCandidates, type ScoreCandidatesOptions } from "./scoreCandidates.js";
import type {
  BuildRoutePlanResult,
  ExplicitModelRuntimeFallbackPlan,
  RankedRouteCandidate
} from "./routingTypes.js";

export interface BuildRoutePlanOptions extends FilterCandidatesOptions, ScoreCandidatesOptions {
  enableExplicitModelRuntimeFallback?: boolean;
}

export function buildRoutePlan(
  models: CatalogModel[],
  routeRequest: NormalizedRouteRequest,
  requestedModel: string,
  options: BuildRoutePlanOptions = {}
): BuildRoutePlanResult {
  const filteredResult = filterCandidates(models, routeRequest, requestedModel, options);

  if (filteredResult.candidates.length === 0) {
    return {
      ok: false,
      error: {
        code: "no_eligible_model",
        message: "No eligible model matched the current routing policy.",
        requested_model: requestedModel,
        resolved_model: filteredResult.resolved_model,
        normalized_request: routeRequest,
        reasons: buildNoCandidateReasons(routeRequest, filteredResult.resolved_model.required_modalities)
      }
    };
  }

  const rankedCandidates = scoreCandidates(filteredResult.candidates, routeRequest, options);
  const selectedCandidate = rankedCandidates[0];

  if (!selectedCandidate) {
    return {
      ok: false,
      error: {
        code: "no_eligible_model",
        message: "No eligible model remained after scoring.",
        requested_model: requestedModel,
        resolved_model: filteredResult.resolved_model,
        normalized_request: routeRequest,
        reasons: ["candidate scoring produced an empty result set"]
      }
    };
  }

  return {
    ok: true,
    plan: {
      mode: "direct",
      requested_model: requestedModel,
      resolved_model: filteredResult.resolved_model,
      normalized_request: routeRequest,
      selected_model: selectedCandidate.model.model_id,
      fallback_chain: rankedCandidates.slice(1).map((candidate) => candidate.model.model_id),
      ...(options.enableExplicitModelRuntimeFallback
        ? buildExplicitModelRuntimeFallbackPlan(models, routeRequest, requestedModel, options)
        : {}),
      reasons: buildSelectionReasons(routeRequest, filteredResult.resolved_model.requested_alias),
      ranked_candidates: rankedCandidates.map(mapRankedCandidate)
    }
  };
}

function buildNoCandidateReasons(
  routeRequest: NormalizedRouteRequest,
  requiredModalities: string[]
) {
  return [
    "no active candidate satisfied the current free-first policy",
    `required modalities: ${requiredModalities.join(", ") || "text"}`,
    `required features: ${routeRequest.required_features.join(", ") || "none"}`,
    `minimum context length: ${routeRequest.preferred_context_length}`
  ];
}

function buildSelectionReasons(
  routeRequest: NormalizedRouteRequest,
  requestedAlias: string | null
) {
  const reasons = ["selected the highest-scoring eligible candidate for direct execution"];

  if (requestedAlias) {
    reasons.push(`resolved requested alias ${requestedAlias} using the current catalog snapshot`);
  }

  if (routeRequest.required_features.length > 0) {
    reasons.push(`required features: ${routeRequest.required_features.join(", ")}`);
  }

  if (routeRequest.required_modalities.length > 1) {
    reasons.push(`required modalities: ${routeRequest.required_modalities.join(", ")}`);
  }

  return reasons;
}

function mapRankedCandidate(candidate: {
  model: CatalogModel;
  final_score: number;
  breakdown: RankedRouteCandidate["breakdown"];
}): RankedRouteCandidate {
  return {
    model_id: candidate.model.model_id,
    display_name: candidate.model.display_name,
    final_score: candidate.final_score,
    breakdown: candidate.breakdown
  };
}

function buildExplicitModelRuntimeFallbackPlan(
  models: CatalogModel[],
  routeRequest: NormalizedRouteRequest,
  requestedModel: string,
  options: BuildRoutePlanOptions
) {
  const resolvedModel = resolveModelAlias(requestedModel, routeRequest);
  const explicitModelId = resolvedModel.explicit_model_id;

  if (!explicitModelId) {
    return {};
  }

  const fallbackResolvedModel = {
    requested_model: requestedModel,
    requested_alias: null,
    prefer_free: resolvedModel.prefer_free,
    required_modalities: resolvedModel.required_modalities
  };
  const filteredResult = filterCandidates(models, routeRequest, requestedModel, {
    ...options,
    resolvedModelOverride: fallbackResolvedModel,
    excludeModelIds: [explicitModelId]
  });

  if (filteredResult.candidates.length === 0) {
    return {};
  }

  const rankedCandidates = scoreCandidates(filteredResult.candidates, routeRequest, options);
  const selectedCandidate = rankedCandidates[0];

  if (!selectedCandidate) {
    return {};
  }

  const runtimeFallback: ExplicitModelRuntimeFallbackPlan = {
    trigger: "explicit_model_runtime_failure",
    selected_model: selectedCandidate.model.model_id,
    fallback_chain: rankedCandidates.slice(1).map((candidate) => candidate.model.model_id),
    reasons: [
      `retry a task-matched fallback route only if explicit model ${explicitModelId} fails at runtime`,
      "only applies to retriable upstream failures such as 404, 408, 429, or 5xx"
    ],
    ranked_candidates: rankedCandidates.map(mapRankedCandidate)
  };

  return {
    runtime_fallback: runtimeFallback
  };
}
