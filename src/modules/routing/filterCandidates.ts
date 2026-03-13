import type { CatalogModel } from "../catalog/catalogTypes.js";
import type { NormalizedRouteRequest, RequiredFeature } from "./requestAnalyzer.js";
import { resolveModelAlias, type ResolvedModelAlias } from "./modelAliases.js";

export interface FilterCandidatesOptions {
  healthThreshold?: number;
  resolvedModelOverride?: ResolvedModelAlias;
  excludeModelIds?: string[];
}

export interface CandidateFilterResult {
  resolved_model: ResolvedModelAlias;
  candidates: CatalogModel[];
}

const FEATURE_PARAMETER_MAP: Record<Exclude<RequiredFeature, "streaming">, string[]> = {
  tools: ["tools"],
  response_format: ["response_format", "structured_outputs"]
};

export function filterCandidates(
  models: CatalogModel[],
  routeRequest: NormalizedRouteRequest,
  requestedModel: string,
  options: FilterCandidatesOptions = {}
): CandidateFilterResult {
  const resolvedModel = options.resolvedModelOverride ?? resolveModelAlias(requestedModel, routeRequest);
  const healthThreshold = options.healthThreshold ?? 0.35;
  const excludedModelIds = new Set(options.excludeModelIds ?? []);
  const filtered = models.filter((model) => {
    if (!model.is_active) {
      return false;
    }

    if (excludedModelIds.has(model.model_id)) {
      return false;
    }

    if (resolvedModel.explicit_model_id && model.model_id !== resolvedModel.explicit_model_id) {
      return false;
    }

    if (resolvedModel.prefer_free && !model.is_free_text) {
      return false;
    }

    if (!supportsAllModalities(model, resolvedModel.required_modalities)) {
      return false;
    }

    if (!supportsAllFeatures(model, routeRequest.required_features)) {
      return false;
    }

    if (model.context_length < routeRequest.preferred_context_length) {
      return false;
    }

    return getHealthFloor(model) >= healthThreshold;
  });

  return {
    resolved_model: resolvedModel,
    candidates: filtered
  };
}

function supportsAllModalities(model: CatalogModel, requiredModalities: ResolvedModelAlias["required_modalities"]) {
  return requiredModalities.every((modality) => model.input_modalities.includes(modality));
}

function supportsAllFeatures(model: CatalogModel, requiredFeatures: NormalizedRouteRequest["required_features"]) {
  return requiredFeatures.every((feature) => isFeatureSupported(model, feature));
}

function isFeatureSupported(model: CatalogModel, feature: RequiredFeature) {
  if (feature === "streaming") {
    return true;
  }

  const supportedParameters = new Set(model.supported_parameters);
  return FEATURE_PARAMETER_MAP[feature].some((parameter) => supportedParameters.has(parameter));
}

function getHealthFloor(model: CatalogModel) {
  return Math.min(
    model.health.uptime_score,
    model.health.latency_score,
    model.health.throughput_score,
    model.health.recent_success_score
  );
}
