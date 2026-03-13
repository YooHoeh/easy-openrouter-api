import type { NormalizedRouteRequest } from "./requestAnalyzer.js";
import type { ResolvedModelAlias } from "./modelAliases.js";
import type { CandidateScoreBreakdown } from "./scoreCandidates.js";

export interface RankedRouteCandidate {
  model_id: string;
  display_name: string;
  final_score: number;
  breakdown: CandidateScoreBreakdown;
}

export interface ExplicitModelRuntimeFallbackPlan {
  trigger: "explicit_model_runtime_failure";
  selected_model: string;
  fallback_chain: string[];
  reasons: string[];
  ranked_candidates: RankedRouteCandidate[];
}

export interface DirectRoutePlan {
  mode: "direct";
  requested_model: string;
  resolved_model: ResolvedModelAlias;
  normalized_request: NormalizedRouteRequest;
  selected_model: string;
  fallback_chain: string[];
  runtime_fallback?: ExplicitModelRuntimeFallbackPlan;
  reasons: string[];
  ranked_candidates: RankedRouteCandidate[];
}

export interface RoutePlanError {
  code: "no_eligible_model";
  message: string;
  requested_model: string;
  resolved_model: ResolvedModelAlias;
  normalized_request: NormalizedRouteRequest;
  reasons: string[];
}

export type BuildRoutePlanResult =
  | {
      ok: true;
      plan: DirectRoutePlan;
    }
  | {
      ok: false;
      error: RoutePlanError;
    };
