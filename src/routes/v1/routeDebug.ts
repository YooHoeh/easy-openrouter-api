import type { FastifyPluginAsync } from "fastify";

import type { EasyApiServices } from "../../app/appServices.js";
import type { Env } from "../../config/env.js";
import {
  invalidRequestError,
  noEligibleModelError,
  toOpenAIErrorResponse,
  upstreamUnavailableError
} from "../../lib/errors.js";
import {
  buildVisionReasoningRouteRequest,
  orchestrateVisionRequest
} from "../../modules/orchestration/orchestrateVisionRequest.js";
import { buildRoutePlan } from "../../modules/routing/buildRoutePlan.js";
import { analyzeChatCompletionsRequest } from "../../modules/routing/requestAnalyzer.js";
import { ChatCompletionsRequestSchema } from "../../modules/routing/requestSchemas.js";
import {
  buildRouteDebugPayload,
  buildVisionOrchestrationDebugPayload,
  buildRouteErrorDebugPayload
} from "../../modules/telemetry/debugRoutePayload.js";

interface RouteDebugRouteOptions {
  services: EasyApiServices;
  env: Env;
}

export const registerRouteDebugRoutes: FastifyPluginAsync<RouteDebugRouteOptions> = async (
  app,
  options
) => {
  app.post("/v1/route/debug", async (request, reply) => {
    const parsedRequest = ChatCompletionsRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      const error = invalidRequestError("Invalid route debug request body.");
      return reply.status(error.statusCode).send(toOpenAIErrorResponse(error));
    }

    const normalizedRequest = analyzeChatCompletionsRequest(parsedRequest.data, {
      debug: true,
      allowPaidFallback: options.env.ALLOW_PAID_FALLBACK
    });
    const snapshot =
      (await options.services.catalogRepository.getSnapshot()) ??
      (await options.services.catalogSyncService?.sync()) ??
      null;

    if (!snapshot) {
      const error = upstreamUnavailableError("Model catalog is unavailable.");
      return reply.status(error.statusCode).send(toOpenAIErrorResponse(error));
    }

    const directPlanResult = buildRoutePlan(snapshot.models, normalizedRequest, parsedRequest.data.model, {
      enableExplicitModelRuntimeFallback: options.env.ENABLE_EXPLICIT_MODEL_RUNTIME_FALLBACK
    });
    const orchestrationPreview = buildVisionOrchestrationPreview(
      parsedRequest.data,
      normalizedRequest,
      snapshot.models,
      options.env.ENABLE_EXPLICIT_MODEL_RUNTIME_FALLBACK
    );

    return reply.status(200).send({
      object: "easyapi.route.debug",
      requested_model: parsedRequest.data.model,
      normalized_request: normalizedRequest,
      catalog: {
        source: snapshot.source,
        version: snapshot.version,
        synced_at: snapshot.synced_at,
        model_count: snapshot.models.length
      },
      direct: directPlanResult.ok
        ? {
            ok: true,
            route: buildRouteDebugPayload(directPlanResult.plan)
          }
        : {
            ok: false,
            error: buildRouteErrorDebugPayload(directPlanResult.error, {
              code: noEligibleModelError(directPlanResult.error.message).code
            })
          },
      ...(orchestrationPreview
        ? {
            orchestration_preview: orchestrationPreview
          }
        : {})
    });
  });
};

function buildVisionOrchestrationPreview(
  request: Parameters<typeof orchestrateVisionRequest>[0]["request"],
  normalizedRequest: Parameters<typeof buildVisionOrchestrationDebugPayload>[0]["normalizedRequest"],
  models: Parameters<typeof buildRoutePlan>[0],
  enableExplicitModelRuntimeFallback: boolean
) {
  if (!normalizedRequest.required_modalities.includes("image")) {
    return undefined;
  }

  const reasoningRequest = buildVisionReasoningRouteRequest(request.model, normalizedRequest);
  const reasoningPlanResult = buildRoutePlan(models, reasoningRequest, request.model, {
    enableExplicitModelRuntimeFallback
  });

  if (!reasoningPlanResult.ok) {
    return {
      ok: false,
      error: buildRouteErrorDebugPayload(reasoningPlanResult.error, {
        code: reasoningPlanResult.error.code
      })
    };
  }

  const orchestrationResult = orchestrateVisionRequest({
    request,
    routeRequest: normalizedRequest,
    reasoningPlan: reasoningPlanResult.plan,
    models
  });

  if (!orchestrationResult.ok) {
    return {
      ok: false,
      error: {
        code: orchestrationResult.error.code,
        message: orchestrationResult.error.message,
        reasons: orchestrationResult.error.reasons
      }
    };
  }

  return {
    ok: true,
    route: buildVisionOrchestrationDebugPayload({
      requestedModel: request.model,
      normalizedRequest,
      reasoningPlan: reasoningPlanResult.plan,
      plan: orchestrationResult.plan
    })
  };
}
