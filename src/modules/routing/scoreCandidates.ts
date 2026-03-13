import type { CatalogModel } from "../catalog/catalogTypes.js";
import type { NormalizedRouteRequest } from "./requestAnalyzer.js";
import {
  DEFAULT_TASK_PRIORS,
  getTaskPriorScore,
  type TaskPriorConfig
} from "./taskPriors.js";

export interface ScoreWeights {
  capability_score: number;
  task_prior_score: number;
  uptime_score: number;
  latency_score: number;
  throughput_score: number;
  recent_success_score: number;
}

export interface CandidateScoreBreakdown {
  capability_score: number;
  task_prior_score: number;
  uptime_score: number;
  latency_score: number;
  throughput_score: number;
  recent_success_score: number;
}

export interface ScoredCandidate {
  model: CatalogModel;
  final_score: number;
  breakdown: CandidateScoreBreakdown;
}

export interface ScoreCandidatesOptions {
  taskPriors?: TaskPriorConfig;
  weights?: ScoreWeights;
}

const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  capability_score: 0.35,
  task_prior_score: 0.25,
  uptime_score: 0.2,
  latency_score: 0.1,
  throughput_score: 0.05,
  recent_success_score: 0.05
};

export function scoreCandidates(
  candidates: CatalogModel[],
  routeRequest: NormalizedRouteRequest,
  options: ScoreCandidatesOptions = {}
): ScoredCandidate[] {
  const taskPriors = options.taskPriors ?? DEFAULT_TASK_PRIORS;
  const weights = options.weights ?? DEFAULT_SCORE_WEIGHTS;

  return candidates
    .map((model) => {
      const baseTaskPriorScore = getTaskPriorScore(model, routeRequest.task_type, taskPriors);
      const breakdown: CandidateScoreBreakdown = {
        capability_score: calculateCapabilityScore(model, routeRequest),
        task_prior_score: adjustTaskPriorScoreForStreamingGeneralChat(
          model,
          routeRequest,
          baseTaskPriorScore
        ),
        uptime_score: model.health.uptime_score,
        latency_score: model.health.latency_score,
        throughput_score: model.health.throughput_score,
        recent_success_score: model.health.recent_success_score
      };

      return {
        model,
        breakdown,
        final_score: roundScore(
          breakdown.capability_score * weights.capability_score +
            breakdown.task_prior_score * weights.task_prior_score +
            breakdown.uptime_score * weights.uptime_score +
            breakdown.latency_score * weights.latency_score +
            breakdown.throughput_score * weights.throughput_score +
            breakdown.recent_success_score * weights.recent_success_score
        )
      };
    })
    .sort((left, right) => {
      if (right.final_score !== left.final_score) {
        return right.final_score - left.final_score;
      }

      return left.model.model_id.localeCompare(right.model.model_id);
    });
}

function calculateCapabilityScore(model: CatalogModel, routeRequest: NormalizedRouteRequest) {
  const matchedModalities = routeRequest.required_modalities.filter((modality) =>
    model.input_modalities.includes(modality)
  ).length;
  const modalityScore =
    routeRequest.required_modalities.length === 0 ? 1 : matchedModalities / routeRequest.required_modalities.length;
  const featureRequirements = routeRequest.required_features.filter((feature) => feature !== "streaming");
  const matchedFeatures = featureRequirements.filter((feature) =>
    model.supported_parameters.includes(feature === "response_format" ? "response_format" : feature)
      || (feature === "response_format" && model.supported_parameters.includes("structured_outputs"))
  ).length;
  const featureScore =
    featureRequirements.length === 0 ? 1 : matchedFeatures / featureRequirements.length;
  const contextScore =
    routeRequest.preferred_context_length <= 0
      ? 1
      : Math.min(model.context_length / routeRequest.preferred_context_length, 1);

  return roundScore(modalityScore * 0.5 + featureScore * 0.3 + contextScore * 0.2);
}

function roundScore(score: number) {
  return Math.round(score * 10_000) / 10_000;
}

function adjustTaskPriorScoreForStreamingGeneralChat(
  model: Pick<CatalogModel, "model_id" | "display_name">,
  routeRequest: NormalizedRouteRequest,
  baseScore: number
) {
  if (!isSimpleStreamingGeneralChat(routeRequest)) {
    return baseScore;
  }

  const normalizedModelId = `${model.model_id} ${model.display_name}`.toLowerCase();

  if (normalizedModelId.includes("step-3.5-flash")) {
    return 0.97;
  }

  if (normalizedModelId.includes("glm-4.5-air")) {
    return 0.95;
  }

  if (normalizedModelId.includes("qwen3-next-80b-a3b-instruct")) {
    return 0.92;
  }

  if (normalizedModelId.includes("gemma-3-27b-it")) {
    return 0.9;
  }

  if (normalizedModelId.includes("gpt-oss-20b")) {
    return Math.min(baseScore, 0.83);
  }

  if (normalizedModelId.includes("gpt-oss-120b")) {
    return Math.min(baseScore, 0.78);
  }

  return baseScore;
}

function isSimpleStreamingGeneralChat(routeRequest: NormalizedRouteRequest) {
  return routeRequest.task_type === "general_chat"
    && routeRequest.required_modalities.length === 1
    && routeRequest.required_modalities[0] === "text"
    && routeRequest.required_features.includes("streaming")
    && !routeRequest.required_features.includes("tools")
    && !routeRequest.required_features.includes("response_format");
}
