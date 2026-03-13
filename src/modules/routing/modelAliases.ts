import type { NormalizedRouteRequest, RequiredModality } from "./requestAnalyzer.js";

export const STABLE_MODEL_ALIASES = [
  "auto",
  "auto:free",
  "auto:vision",
  "auto:coding",
  "auto:reasoning"
] as const;

export type StableModelAlias = (typeof STABLE_MODEL_ALIASES)[number];

export interface ResolvedModelAlias {
  requested_model: string;
  requested_alias: StableModelAlias | null;
  explicit_model_id?: string;
  prefer_free: boolean;
  required_modalities: RequiredModality[];
}

const MODALITY_ORDER: RequiredModality[] = ["text", "image", "audio"];
const DEFAULT_ALIAS_ROUTE_REQUESTS: Record<StableModelAlias, NormalizedRouteRequest> = {
  auto: {
    task_type: "general_chat",
    required_modalities: ["text"],
    required_features: [],
    preferred_context_length: 16000,
    allow_paid_fallback: false,
    debug: false
  },
  "auto:free": {
    task_type: "general_chat",
    required_modalities: ["text"],
    required_features: [],
    preferred_context_length: 16000,
    allow_paid_fallback: false,
    debug: false
  },
  "auto:vision": {
    task_type: "vision_qa",
    required_modalities: ["text", "image"],
    required_features: [],
    preferred_context_length: 32000,
    allow_paid_fallback: false,
    debug: false
  },
  "auto:coding": {
    task_type: "coding",
    required_modalities: ["text"],
    required_features: [],
    preferred_context_length: 32000,
    allow_paid_fallback: false,
    debug: false
  },
  "auto:reasoning": {
    task_type: "reasoning",
    required_modalities: ["text"],
    required_features: [],
    preferred_context_length: 32000,
    allow_paid_fallback: false,
    debug: false
  }
};

export function resolveModelAlias(
  requestedModel: string,
  routeRequest: NormalizedRouteRequest
): ResolvedModelAlias {
  const requestedAlias = isStableModelAlias(requestedModel) ? requestedModel : null;
  const requiredModalities = new Set(routeRequest.required_modalities);

  if (requestedAlias === "auto:vision") {
    requiredModalities.add("image");
  }

  return {
    requested_model: requestedModel,
    requested_alias: requestedAlias,
    prefer_free: requestedAlias !== null || !routeRequest.allow_paid_fallback,
    required_modalities: MODALITY_ORDER.filter((modality) => requiredModalities.has(modality)),
    ...(requestedAlias ? {} : { explicit_model_id: requestedModel })
  };
}

export function isStableModelAlias(value: string): value is StableModelAlias {
  return STABLE_MODEL_ALIASES.includes(value as StableModelAlias);
}

export function getAliasRouteRequest(alias: StableModelAlias): NormalizedRouteRequest {
  return DEFAULT_ALIAS_ROUTE_REQUESTS[alias];
}
