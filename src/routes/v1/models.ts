import type { FastifyPluginAsync } from "fastify";

import type { EasyApiServices } from "../../app/appServices.js";
import type { CatalogModel } from "../../modules/catalog/catalogTypes.js";
import { buildRoutePlan } from "../../modules/routing/buildRoutePlan.js";
import {
  getAliasRouteRequest,
  STABLE_MODEL_ALIASES,
  type StableModelAlias
} from "../../modules/routing/modelAliases.js";
import type { ModelListResponse, OpenAIModel } from "../../types/openai.js";

const DEFAULT_CREATED_AT = 1_773_300_000;

const STABLE_ALIASES: OpenAIModel[] = STABLE_MODEL_ALIASES.map((id) => ({
  id,
  object: "model",
  created: DEFAULT_CREATED_AT,
  owned_by: "easy-api"
}));

interface ModelsRouteOptions {
  services: EasyApiServices;
}

export const registerModelsRoutes: FastifyPluginAsync<ModelsRouteOptions> = async (app, options) => {
  app.get("/v1/models", async (): Promise<ModelListResponse> => {
    const snapshot = await getCatalogSnapshot(options.services);

    return {
      object: "list",
      data: snapshot ? [...STABLE_ALIASES, ...buildRecommendedModels(snapshot.models)] : STABLE_ALIASES
    };
  });

  app.get("/v1/models/auto", async () => {
    const snapshot = await getCatalogSnapshot(options.services);

    return {
      object: "easyapi.auto_models",
      catalog: {
        available: snapshot !== null,
        ...(snapshot
          ? {
              source: snapshot.source,
              version: snapshot.version,
              synced_at: snapshot.synced_at
            }
          : {}),
        model_count: snapshot?.models.length ?? 0
      },
      data: STABLE_MODEL_ALIASES.map((alias) => buildAutoModelEntry(alias, snapshot?.models ?? []))
    };
  });
};

async function getCatalogSnapshot(services: EasyApiServices) {
  return (
    (await services.catalogRepository.getSnapshot()) ??
    (await services.catalogSyncService?.sync()) ??
    null
  );
}

function buildAutoModelEntry(alias: StableModelAlias, models: CatalogModel[]) {
  const routeRequest = getAliasRouteRequest(alias);
  const routePlan = buildRoutePlan(models, routeRequest, alias);

  return routePlan.ok
    ? {
        id: alias,
        object: "easyapi.auto_model",
        available: true,
        selected_model: routePlan.plan.selected_model,
        fallback_chain: routePlan.plan.fallback_chain,
        required_modalities: routeRequest.required_modalities,
        required_features: routeRequest.required_features,
        reasons: routePlan.plan.reasons
      }
    : {
        id: alias,
        object: "easyapi.auto_model",
        available: false,
        required_modalities: routeRequest.required_modalities,
        required_features: routeRequest.required_features,
        reasons: routePlan.error.reasons
      };
}

function buildRecommendedModels(models: CatalogModel[]): OpenAIModel[] {
  const recommendedModelIds = new Set<string>();

  for (const alias of STABLE_MODEL_ALIASES) {
    const routePlan = buildRoutePlan(models, getAliasRouteRequest(alias), alias);

    if (routePlan.ok) {
      recommendedModelIds.add(routePlan.plan.selected_model);
    }
  }

  return [...recommendedModelIds]
    .map((modelId) => {
      const model = models.find((entry) => entry.model_id === modelId);

      if (!model) {
        return null;
      }

      return mapCatalogModelToOpenAIModel(model.model_id, model.created_at);
    })
    .filter((model): model is OpenAIModel => model !== null);
}

function mapCatalogModelToOpenAIModel(modelId: string, createdAt?: number): OpenAIModel {
  return {
    id: modelId,
    object: "model",
    created: createdAt ?? DEFAULT_CREATED_AT,
    owned_by: getModelOwner(modelId)
  };
}

function getModelOwner(modelId: string) {
  const [owner] = modelId.split("/");
  return owner || "openrouter";
}
