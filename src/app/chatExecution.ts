import {
  createChatCompletionSseStream
} from "../lib/chatCompletionStreaming.js";
import {
  noEligibleModelError,
  upstreamUnavailableError,
  type EasyApiError
} from "../lib/errors.js";
import {
  executeVisionOrchestration,
  executeVisionOrchestrationStream,
  prepareVisionOrchestration,
  type PreparedVisionOrchestration
} from "../modules/orchestration/executeVisionOrchestration.js";
import type { ExecutedChatCompletionStreamResult } from "../modules/adapters/openrouter/openrouterExecutionClient.js";
import { shouldPreferVisionOrchestration } from "../modules/orchestration/orchestrateVisionRequest.js";
import { buildRoutePlan } from "../modules/routing/buildRoutePlan.js";
import { analyzeChatCompletionsRequest } from "../modules/routing/requestAnalyzer.js";
import type { ParsedChatCompletionsRequest } from "../modules/routing/requestSchemas.js";
import type { DirectRoutePlan, RoutePlanError } from "../modules/routing/routingTypes.js";
import {
  buildRouteDebugPayload,
  buildVisionOrchestrationDebugPayload
} from "../modules/telemetry/debugRoutePayload.js";
import type { EasyApiServices } from "./appServices.js";

export type ExecutionTarget =
  | {
      mode: "direct";
      routePlan: DirectRoutePlan;
    }
  | {
      mode: "orchestrated";
      prepared: PreparedVisionOrchestration;
    };

export interface PreparedChatRequestExecution {
  request: ParsedChatCompletionsRequest;
  target: ExecutionTarget;
}

export type PrepareChatRequestExecutionResult =
  | {
      ok: true;
      prepared: PreparedChatRequestExecution;
    }
  | {
      ok: false;
      error: EasyApiError;
      route_mode: string;
      route_error?: RoutePlanError;
    };

export type ExecutedPreparedChatRequest = Awaited<
  ReturnType<NonNullable<EasyApiServices["executionClient"]>["executeChatCompletion"]>
> | Awaited<ReturnType<typeof executeVisionOrchestration>>;

export type ExecutedPreparedChatRequestStream =
  | ExecutedChatCompletionStreamResult
  | Awaited<ReturnType<typeof executeVisionOrchestrationStream>>
  | Awaited<ReturnType<typeof buildSyntheticStreamingExecution>>;

export async function prepareChatRequestExecution(input: {
  request: ParsedChatCompletionsRequest;
  services: Pick<EasyApiServices, "catalogRepository" | "catalogSyncService">;
  debug: boolean;
  allowPaidFallback: boolean;
  enableExplicitModelRuntimeFallback: boolean;
}): Promise<PrepareChatRequestExecutionResult> {
  const analysis = analyzeChatCompletionsRequest(input.request, {
    debug: input.debug,
    allowPaidFallback: input.allowPaidFallback
  });
  const snapshot =
    (await input.services.catalogRepository.getSnapshot()) ??
    (await input.services.catalogSyncService?.sync()) ??
    null;

  if (!snapshot) {
    return {
      ok: false,
      error: upstreamUnavailableError("Model catalog is unavailable."),
      route_mode: "catalog"
    };
  }

  const directPlanResult = buildRoutePlan(snapshot.models, analysis, input.request.model, {
    enableExplicitModelRuntimeFallback: input.enableExplicitModelRuntimeFallback
  });
  const orchestrationPreparation = analysis.required_modalities.includes("image")
    ? prepareVisionOrchestration({
        request: input.request,
        routeRequest: analysis,
        models: snapshot.models,
        enableExplicitModelRuntimeFallback: input.enableExplicitModelRuntimeFallback
      })
    : null;
  const executionTarget = resolveExecutionTarget(
    input.request.model,
    analysis,
    directPlanResult,
    orchestrationPreparation
  );

  if (!executionTarget) {
    return {
      ok: false,
      error: noEligibleModelError(
        directPlanResult.ok
          ? "No eligible model matched the current routing policy."
          : directPlanResult.error.message
      ),
      route_mode: "unavailable",
      ...(!directPlanResult.ok ? { route_error: directPlanResult.error } : {})
    };
  }

  return {
    ok: true,
    prepared: {
      request: input.request,
      target: executionTarget
    }
  };
}

export async function executePreparedChatRequest(
  prepared: PreparedChatRequestExecution,
  executionClient: NonNullable<EasyApiServices["executionClient"]>
): Promise<ExecutedPreparedChatRequest> {
  if (prepared.target.mode === "orchestrated") {
    return executeVisionOrchestration({
      request: prepared.request,
      prepared: prepared.target.prepared,
      executionClient
    });
  }

  return executionClient.executeChatCompletion({
    request: prepared.request,
    routePlan: prepared.target.routePlan
  });
}

export async function executePreparedChatRequestStream(
  prepared: PreparedChatRequestExecution,
  executionClient: NonNullable<EasyApiServices["executionClient"]>
): Promise<ExecutedPreparedChatRequestStream> {
  if (prepared.target.mode === "orchestrated") {
    return executeVisionOrchestrationStream({
      request: prepared.request,
      prepared: prepared.target.prepared,
      executionClient
    });
  }

  if (executionClient.executeChatCompletionStream) {
    return executionClient.executeChatCompletionStream({
      request: prepared.request,
      routePlan: prepared.target.routePlan
    });
  }

  return buildSyntheticStreamingExecution(executionClient, {
    request: prepared.request,
    routePlan: prepared.target.routePlan
  });
}

export function buildSuccessfulRouteDebugPayload(
  target: ExecutionTarget,
  execution: ExecutedPreparedChatRequest
) {
  if (target.mode === "direct") {
    const directExecution = execution as Exclude<
      ExecutedPreparedChatRequest,
      Awaited<ReturnType<typeof executeVisionOrchestration>>
    >;

    return buildRouteDebugPayload(target.routePlan, {
      actualModel: directExecution.actualModel,
      attemptedModels: directExecution.attemptedModels,
      fallbackUsed: directExecution.fallbackUsed,
      runtimeFallbackUsed: directExecution.runtimeFallbackUsed ?? false
    });
  }

  const orchestratedExecution = execution as Awaited<ReturnType<typeof executeVisionOrchestration>>;

  return buildVisionOrchestrationDebugPayload({
    requestedModel: target.prepared.requestedModel,
    normalizedRequest: target.prepared.normalizedRequest,
    reasoningPlan: target.prepared.reasoningPlan,
    plan: target.prepared.plan
  }, {
    reasoning: {
      actualModel: orchestratedExecution.actualModel,
      attemptedModels: orchestratedExecution.reasoningAttemptedModels,
      fallbackUsed: orchestratedExecution.reasoningFallbackUsed,
      runtimeFallbackUsed: orchestratedExecution.reasoningRuntimeFallbackUsed
    },
    preprocessors: orchestratedExecution.preprocessorExecutions.map((preprocessor) => ({
      actualModel: preprocessor.actualModel,
      attemptedModels: preprocessor.attemptedModels,
      fallbackUsed: preprocessor.fallbackUsed,
      runtimeFallbackUsed: preprocessor.runtimeFallbackUsed
    }))
  });
}

export function buildExecutionDebugPayload(target: ExecutionTarget) {
  if (target.mode === "direct") {
    return buildRouteDebugPayload(target.routePlan);
  }

  return buildVisionOrchestrationDebugPayload({
    requestedModel: target.prepared.requestedModel,
    normalizedRequest: target.prepared.normalizedRequest,
    reasoningPlan: target.prepared.reasoningPlan,
    plan: target.prepared.plan
  });
}

export function getSelectedModel(target: ExecutionTarget) {
  return target.mode === "direct"
    ? target.routePlan.selected_model
    : target.prepared.reasoningPlan.selected_model;
}

export function getSelectedPreprocessors(target: ExecutionTarget) {
  return target.mode === "direct"
    ? []
    : target.prepared.plan.preprocessors.map((preprocessor) => preprocessor.model);
}

export function getFallbackUsedOnError(target: ExecutionTarget) {
  if (target.mode === "direct") {
    return target.routePlan.fallback_chain.length > 0
      || Boolean(target.routePlan.runtime_fallback);
  }

  return target.prepared.preprocessorPlan.fallback_chain.length > 0
    || target.prepared.reasoningPlan.fallback_chain.length > 0
    || Boolean(target.prepared.reasoningPlan.runtime_fallback);
}

function resolveExecutionTarget(
  requestedModel: string,
  analysis: Parameters<typeof shouldPreferVisionOrchestration>[1],
  directPlanResult: ReturnType<typeof buildRoutePlan>,
  orchestrationPreparation: ReturnType<typeof prepareVisionOrchestration> | null
): ExecutionTarget | null {
  const preferVisionOrchestration = shouldPreferVisionOrchestration(requestedModel, analysis);

  if (preferVisionOrchestration && orchestrationPreparation?.ok) {
    return {
      mode: "orchestrated",
      prepared: orchestrationPreparation.prepared
    };
  }

  if (directPlanResult.ok) {
    return {
      mode: "direct",
      routePlan: directPlanResult.plan
    };
  }

  if (orchestrationPreparation?.ok) {
    return {
      mode: "orchestrated",
      prepared: orchestrationPreparation.prepared
    };
  }

  return null;
}

async function buildSyntheticStreamingExecution(
  executor: NonNullable<EasyApiServices["executionClient"]>,
  params: Parameters<NonNullable<EasyApiServices["executionClient"]>["executeChatCompletion"]>[0]
) {
  const execution = await executor.executeChatCompletion(params);

  return {
    ...execution,
    stream: createChatCompletionSseStream(execution.response)
  };
}
