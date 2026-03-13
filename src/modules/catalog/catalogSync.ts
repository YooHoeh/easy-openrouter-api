import type { CatalogRepository } from "./catalogRepository.js";
import type {
  CatalogHealthScores,
  CatalogModel,
  CatalogModality,
  CatalogProviderEndpoint,
  CatalogSnapshot
} from "./catalogTypes.js";
import type { OpenRouterModel } from "./openrouterClient.js";

export interface OpenRouterCatalogClient {
  fetchModels(): Promise<OpenRouterModel[]>;
}

export interface CatalogSyncServiceOptions {
  now?: () => Date;
}

const MODALITY_ORDER: CatalogModality[] = ["text", "image", "audio", "file", "video"];

export class CatalogSyncService {
  readonly #client: OpenRouterCatalogClient;
  readonly #repository: CatalogRepository;
  readonly #now: () => Date;

  constructor(
    client: OpenRouterCatalogClient,
    repository: CatalogRepository,
    options: CatalogSyncServiceOptions = {}
  ) {
    this.#client = client;
    this.#repository = repository;
    this.#now = options.now ?? (() => new Date());
  }

  async sync(): Promise<CatalogSnapshot> {
    const [previousSnapshot, models] = await Promise.all([
      this.#repository.getSnapshot(),
      this.#client.fetchModels()
    ]);

    const syncedAt = this.#now();
    const snapshot: CatalogSnapshot = {
      source: "openrouter",
      version: (previousSnapshot?.version ?? 0) + 1,
      synced_at: syncedAt.toISOString(),
      models: models
        .map((model) => normalizeOpenRouterModel(model, syncedAt))
        .sort((left, right) => left.model_id.localeCompare(right.model_id))
    };

    await this.#repository.replaceSnapshot(snapshot);

    return snapshot;
  }
}

export function normalizeOpenRouterModel(model: OpenRouterModel, syncedAt: Date): CatalogModel {
  const inputModalities = normalizeModalities(model.architecture?.input_modalities, ["text"]);
  const outputModalities = normalizeModalities(model.architecture?.output_modalities, ["text"]);
  const supportedParameters = uniqueSorted(model.supported_parameters ?? []);
  const pricing = normalizePricing(model.pricing);
  const providerEndpoints = buildProviderEndpoints(model, supportedParameters, pricing);

  return {
    model_id: model.id,
    display_name: model.name,
    input_modalities: inputModalities,
    output_modalities: outputModalities,
    context_length: model.top_provider?.context_length ?? model.context_length ?? 0,
    supported_parameters: supportedParameters,
    pricing,
    is_active: true,
    is_free_text: pricing.prompt === "0" && pricing.completion === "0",
    is_free_image: pricing.image === "0",
    provider_endpoints: providerEndpoints,
    health: buildNeutralHealth(model.top_provider !== undefined),
    last_seen_at: syncedAt.toISOString(),
    ...(model.description ? { description: model.description } : {}),
    ...(model.created ? { created_at: model.created } : {}),
    ...(model.top_provider?.max_completion_tokens
      ? { max_completion_tokens: model.top_provider.max_completion_tokens }
      : {})
  };
}

function normalizeModalities(input: string[] | undefined, fallback: CatalogModality[]): CatalogModality[] {
  if (!input || input.length === 0) {
    return fallback;
  }

  const modalitySet = new Set<CatalogModality>();

  for (const value of input) {
    if (value === "text" || value === "image" || value === "audio" || value === "file" || value === "video") {
      modalitySet.add(value);
    }
  }

  const normalized = MODALITY_ORDER.filter((modality) => modalitySet.has(modality));
  return normalized.length > 0 ? normalized : fallback;
}

function buildProviderEndpoints(
  model: OpenRouterModel,
  supportedParameters: string[],
  pricing: CatalogModel["pricing"]
): CatalogProviderEndpoint[] {
  if (!model.top_provider) {
    return [];
  }

  return [
    {
      name: "top_provider",
      provider_name: "top_provider",
      supported_parameters: supportedParameters,
      pricing,
      ...(model.top_provider.context_length ? { context_length: model.top_provider.context_length } : {}),
      ...(model.top_provider.max_completion_tokens
        ? { max_completion_tokens: model.top_provider.max_completion_tokens }
        : {})
    }
  ];
}

function buildNeutralHealth(hasTopProvider: boolean): CatalogHealthScores {
  const neutral = hasTopProvider ? 0.6 : 0.5;

  return {
    uptime_score: neutral,
    latency_score: neutral,
    throughput_score: neutral,
    recent_success_score: neutral
  };
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalizePricing(pricing: OpenRouterModel["pricing"]): CatalogModel["pricing"] {
  return {
    prompt: pricing.prompt,
    completion: pricing.completion,
    ...(pricing.request ? { request: pricing.request } : {}),
    ...(pricing.image ? { image: pricing.image } : {}),
    ...Object.fromEntries(
      Object.entries(pricing).filter(
        ([key, value]) =>
          key !== "prompt" &&
          key !== "completion" &&
          key !== "request" &&
          key !== "image" &&
          typeof value === "string"
      )
    )
  };
}
