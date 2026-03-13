import type { CatalogModel, CatalogSnapshot } from "./catalogTypes.js";
import { buildRoutePlan } from "../routing/buildRoutePlan.js";
import {
  getAliasRouteRequest,
  STABLE_MODEL_ALIASES,
  type StableModelAlias
} from "../routing/modelAliases.js";

const HEALTHY_MODEL_FLOOR = 0.35;

export function buildCapabilitiesSummary(snapshot: CatalogSnapshot | null) {
  const models = snapshot?.models ?? [];
  const activeModels = models.filter((model) => model.is_active);

  return {
    object: "easyapi.capabilities",
    catalog: {
      available: snapshot !== null,
      ...(snapshot
        ? {
            source: snapshot.source,
            version: snapshot.version,
            synced_at: snapshot.synced_at
          }
        : {}),
      model_count: models.length,
      active_model_count: activeModels.length
    },
    aliases: STABLE_MODEL_ALIASES.map((alias) => buildAliasCapability(alias, models)),
    modalities: {
      text: buildModalityCapability(activeModels, "text", (model) => model.is_free_text),
      image: buildModalityCapability(activeModels, "image", (model) => model.is_free_image),
      audio: buildModalityCapability(activeModels, "audio")
    },
    features: {
      streaming: {
        available: activeModels.length > 0,
        gateway_managed: true,
        direct_model_count: activeModels.length
      },
      tools: buildFeatureCapability(activeModels, ["tools"]),
      response_format: buildFeatureCapability(activeModels, ["response_format", "structured_outputs"])
    },
    orchestration: {
      vision: {
        available:
          activeModels.some((model) => model.input_modalities.includes("text"))
          && activeModels.some((model) => model.input_modalities.includes("image")),
        preprocessor_model_count: activeModels.filter((model) => model.input_modalities.includes("image")).length
      },
      audio: {
        available:
          activeModels.some((model) => model.input_modalities.includes("text"))
          && activeModels.some((model) => model.input_modalities.includes("audio")),
        preprocessor_model_count: activeModels.filter((model) => model.input_modalities.includes("audio")).length
      }
    },
    health: buildHealthSummary(activeModels)
  };
}

function buildAliasCapability(alias: StableModelAlias, models: CatalogModel[]) {
  const routeRequest = getAliasRouteRequest(alias);
  const routePlan = buildRoutePlan(models, routeRequest, alias);

  return routePlan.ok
    ? {
        id: alias,
        available: true,
        selected_model: routePlan.plan.selected_model,
        fallback_chain_length: routePlan.plan.fallback_chain.length,
        required_modalities: routeRequest.required_modalities,
        required_features: routeRequest.required_features
      }
    : {
        id: alias,
        available: false,
        required_modalities: routeRequest.required_modalities,
        required_features: routeRequest.required_features,
        reasons: routePlan.error.reasons
      };
}

function buildModalityCapability(
  activeModels: CatalogModel[],
  modality: "text" | "image" | "audio",
  freePredicate?: (model: CatalogModel) => boolean
) {
  const supportedModels = activeModels.filter((model) => model.input_modalities.includes(modality));

  return {
    available: supportedModels.length > 0,
    active_model_count: supportedModels.length,
    ...(freePredicate
      ? {
          free_model_count: supportedModels.filter((model) => freePredicate(model)).length
        }
      : {})
  };
}

function buildFeatureCapability(activeModels: CatalogModel[], supportedParameters: string[]) {
  const supportedModels = activeModels.filter((model) =>
    supportedParameters.some((parameter) => model.supported_parameters.includes(parameter))
  );

  return {
    available: supportedModels.length > 0,
    active_model_count: supportedModels.length
  };
}

function buildHealthSummary(activeModels: CatalogModel[]) {
  if (activeModels.length === 0) {
    return {
      healthy_model_count: 0,
      average_scores: {
        uptime_score: 0,
        latency_score: 0,
        throughput_score: 0,
        recent_success_score: 0
      },
      floor_range: {
        min: 0,
        max: 0
      }
    };
  }

  const scoreSums = activeModels.reduce(
    (totals, model) => ({
      uptime_score: totals.uptime_score + model.health.uptime_score,
      latency_score: totals.latency_score + model.health.latency_score,
      throughput_score: totals.throughput_score + model.health.throughput_score,
      recent_success_score: totals.recent_success_score + model.health.recent_success_score
    }),
    {
      uptime_score: 0,
      latency_score: 0,
      throughput_score: 0,
      recent_success_score: 0
    }
  );
  const healthFloors = activeModels.map(getHealthFloor);

  return {
    healthy_model_count: healthFloors.filter((score) => score >= HEALTHY_MODEL_FLOOR).length,
    average_scores: {
      uptime_score: roundScore(scoreSums.uptime_score / activeModels.length),
      latency_score: roundScore(scoreSums.latency_score / activeModels.length),
      throughput_score: roundScore(scoreSums.throughput_score / activeModels.length),
      recent_success_score: roundScore(scoreSums.recent_success_score / activeModels.length)
    },
    floor_range: {
      min: roundScore(Math.min(...healthFloors)),
      max: roundScore(Math.max(...healthFloors))
    }
  };
}

function getHealthFloor(model: CatalogModel) {
  return Math.min(
    model.health.uptime_score,
    model.health.latency_score,
    model.health.throughput_score,
    model.health.recent_success_score
  );
}

function roundScore(score: number) {
  return Math.round(score * 10_000) / 10_000;
}
