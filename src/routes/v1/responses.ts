import { Readable } from "node:stream";

import type { FastifyPluginAsync } from "fastify";

import type { EasyApiServices } from "../../app/appServices.js";
import {
  buildExecutionDebugPayload,
  buildSuccessfulRouteDebugPayload,
  executePreparedChatRequest,
  executePreparedChatRequestStream,
  getFallbackUsedOnError,
  getSelectedModel,
  getSelectedPreprocessors,
  prepareChatRequestExecution
} from "../../app/chatExecution.js";
import type { Env } from "../../config/env.js";
import {
  createChatCompletionSseStream,
  createStreamingDebugHeaders
} from "../../lib/chatCompletionStreaming.js";
import {
  type EasyApiError,
  invalidRequestError,
  normalizeError,
  toOpenAIErrorResponse,
  upstreamUnavailableError
} from "../../lib/errors.js";
import {
  createResponsesSseStreamFromChatStream,
  mapChatResponseToResponsesResponse,
  mapResponsesRequestToChatRequest
} from "../../modules/adapters/openai/responses.js";
import { ResponsesRequestSchema } from "../../modules/routing/requestSchemas.js";
import { buildStrictOutputShortcutResponse } from "../../modules/routing/strictOutput.js";
import { buildRouteErrorDebugPayload } from "../../modules/telemetry/debugRoutePayload.js";
import { createChildLogger } from "../../modules/telemetry/logger.js";
import { logRequestRecord } from "../../modules/telemetry/requestLog.js";
import type { OpenAIErrorResponse } from "../../types/openai.js";

interface ResponsesQuerystring {
  debug?: string | number | boolean;
}

interface ResponsesRouteOptions {
  services: EasyApiServices;
  env: Env;
}

export const registerResponsesRoutes: FastifyPluginAsync<ResponsesRouteOptions> = async (
  app,
  options
) => {
  app.post("/v1/responses", async (request, reply) => {
    const startedAt = Date.now();
    const logger = createChildLogger(app.log, {
      request_id: request.id,
      route: "/v1/responses"
    });
    const requestedModel = getRequestedModel(request.body);
    const debug = options.env.ENABLE_DEBUG_ROUTE_METADATA || isDebugEnabled(
      (request.query as ResponsesQuerystring | undefined)?.debug,
      request.headers["x-easyapi-debug"]
    );
    const parsedRequest = ResponsesRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      const error = invalidRequestError("Invalid responses request body.");
      await logRequestRecord(logger, {
        request_id: request.id,
        route: "/v1/responses",
        route_mode: "validation",
        success: false,
        error_code: error.code,
        latency_ms: Date.now() - startedAt,
        ...(requestedModel ? { requested_model: requestedModel } : {})
      }, options.services.requestTelemetrySink);
      return reply.status(error.statusCode).send(toOpenAIErrorResponse(error));
    }

    const unsupportedFeatureError = findUnsupportedResponsesFeature(parsedRequest.data);

    if (unsupportedFeatureError) {
      await logRequestRecord(logger, {
        request_id: request.id,
        route: "/v1/responses",
        requested_model: parsedRequest.data.model,
        route_mode: "unsupported_feature",
        success: false,
        error_code: unsupportedFeatureError.code,
        latency_ms: Date.now() - startedAt
      }, options.services.requestTelemetrySink);
      return reply
        .status(unsupportedFeatureError.statusCode)
        .send(toOpenAIErrorResponse(unsupportedFeatureError));
    }

    const chatRequest = mapResponsesRequestToChatRequest(parsedRequest.data);
    const strictOutputShortcut = buildStrictOutputShortcutResponse(chatRequest);

    if (strictOutputShortcut) {
      if (parsedRequest.data.stream) {
        await logRequestRecord(logger, {
          request_id: request.id,
          route: "/v1/responses",
          requested_model: parsedRequest.data.model,
          route_mode: "shortcut",
          success: true,
          latency_ms: Date.now() - startedAt
        }, options.services.requestTelemetrySink);

        reply
          .code(200)
          .header("content-type", "text/event-stream; charset=utf-8")
          .header("cache-control", "no-cache, no-transform")
          .header("connection", "keep-alive")
          .header("x-accel-buffering", "no");

        return reply.send(
          Readable.from(
            createResponsesSseStreamFromChatStream(
              createChatCompletionSseStream(strictOutputShortcut.response),
              parsedRequest.data.model
            )
          )
        );
      }

      const chatResponse = strictOutputShortcut.response;

      if (debug) {
        chatResponse.route = strictOutputShortcut.route;
      }

      const response = mapChatResponseToResponsesResponse(chatResponse);

      await logRequestRecord(logger, {
        request_id: request.id,
        route: "/v1/responses",
        requested_model: parsedRequest.data.model,
        route_mode: "shortcut",
        success: true,
        latency_ms: Date.now() - startedAt
      }, options.services.requestTelemetrySink);

      return reply.status(200).send(response);
    }

    const preparation = await prepareChatRequestExecution({
      request: chatRequest,
      services: options.services,
      debug,
      allowPaidFallback: options.env.ALLOW_PAID_FALLBACK,
      enableExplicitModelRuntimeFallback: options.env.ENABLE_EXPLICIT_MODEL_RUNTIME_FALLBACK
    });

    if (!preparation.ok) {
      await logRequestRecord(logger, {
        request_id: request.id,
        route: "/v1/responses",
        requested_model: parsedRequest.data.model,
        route_mode: preparation.route_mode,
        success: false,
        error_code: preparation.error.code,
        latency_ms: Date.now() - startedAt
      }, options.services.requestTelemetrySink);
      return reply
        .status(preparation.error.statusCode)
        .send(buildPreparationErrorResponse(preparation.error, preparation.route_error, debug));
    }

    const executionTarget = preparation.prepared.target;

    if (!options.services.executionClient) {
      const error = upstreamUnavailableError("No upstream execution client is configured.");
      await logRequestRecord(logger, {
        request_id: request.id,
        route: "/v1/responses",
        requested_model: parsedRequest.data.model,
        selected_model: getSelectedModel(executionTarget),
        selected_preprocessors: getSelectedPreprocessors(executionTarget),
        route_mode: executionTarget.mode,
        success: false,
        error_code: error.code,
        latency_ms: Date.now() - startedAt
      }, options.services.requestTelemetrySink);
      return reply
        .status(error.statusCode)
        .send(buildExecutionErrorResponse(error, executionTarget, debug));
    }

    try {
      if (parsedRequest.data.stream) {
        const execution = await executePreparedChatRequestStream(
          preparation.prepared,
          options.services.executionClient
        );

        await logRequestRecord(logger, {
          request_id: request.id,
          route: "/v1/responses",
          requested_model: parsedRequest.data.model,
          selected_model: getSelectedModel(executionTarget),
          actual_model: execution.actualModel,
          selected_preprocessors: getSelectedPreprocessors(executionTarget),
          route_mode: executionTarget.mode,
          fallback_used: execution.fallbackUsed,
          success: true,
          latency_ms: Date.now() - startedAt
        }, options.services.requestTelemetrySink);

        const debugHeaders = createStreamingDebugHeaders({
          selectedModel: getSelectedModel(executionTarget),
          actualModel: execution.actualModel,
          attemptedModels: execution.attemptedModels,
          fallbackUsed: execution.fallbackUsed
        }, debug);

        reply
          .code(200)
          .header("content-type", "text/event-stream; charset=utf-8")
          .header("cache-control", "no-cache, no-transform")
          .header("connection", "keep-alive")
          .header("x-accel-buffering", "no");

        for (const [header, value] of Object.entries(debugHeaders)) {
          reply.header(header, value);
        }

        return reply.send(
          Readable.from(createResponsesSseStreamFromChatStream(execution.stream, parsedRequest.data.model))
        );
      }

      const execution = await executePreparedChatRequest(
        preparation.prepared,
        options.services.executionClient
      );
      const chatResponse = execution.response;

      if (debug) {
        chatResponse.route = buildSuccessfulRouteDebugPayload(executionTarget, execution);
      }

      const response = mapChatResponseToResponsesResponse(chatResponse);

      await logRequestRecord(logger, {
        request_id: request.id,
        route: "/v1/responses",
        requested_model: parsedRequest.data.model,
        selected_model: getSelectedModel(executionTarget),
        actual_model: execution.actualModel,
        selected_preprocessors: getSelectedPreprocessors(executionTarget),
        route_mode: executionTarget.mode,
        fallback_used: execution.fallbackUsed,
        success: true,
        latency_ms: Date.now() - startedAt
      }, options.services.requestTelemetrySink);

      return reply.status(200).send(response);
    } catch (cause) {
      const error = normalizeError(cause);
      await logRequestRecord(logger, {
        request_id: request.id,
        route: "/v1/responses",
        requested_model: parsedRequest.data.model,
        selected_model: getSelectedModel(executionTarget),
        selected_preprocessors: getSelectedPreprocessors(executionTarget),
        route_mode: executionTarget.mode,
        fallback_used: getFallbackUsedOnError(executionTarget),
        success: false,
        error_code: error.code,
        latency_ms: Date.now() - startedAt
      }, options.services.requestTelemetrySink);
      return reply
        .status(error.statusCode)
        .send(buildExecutionErrorResponse(error, executionTarget, debug));
    }
  });
};

function buildPreparationErrorResponse(
  error: EasyApiError,
  routeError: { requested_model: string; reasons: string[]; normalized_request?: unknown; resolved_model?: unknown } | undefined,
  debug: boolean
): OpenAIErrorResponse & { route?: Record<string, unknown> } {
  return {
    ...toOpenAIErrorResponse(error),
    ...(debug
      ? routeError
        ? {
            route: buildRouteErrorDebugPayload(routeError, {
              code: error.code
            })
          }
        : {}
      : {})
  };
}

function buildExecutionErrorResponse(
  error: EasyApiError,
  target: Parameters<typeof buildExecutionDebugPayload>[0],
  debug: boolean
): OpenAIErrorResponse & { route?: Record<string, unknown> } {
  return {
    ...toOpenAIErrorResponse(error),
    ...(debug
      ? {
          route: buildExecutionDebugPayload(target)
        }
      : {})
  };
}

function isDebugEnabled(
  debugQueryValue: ResponsesQuerystring["debug"],
  debugHeaderValue: string | string[] | undefined
): boolean {
  return asBoolean(debugQueryValue) || asBoolean(debugHeaderValue);
}

function asBoolean(value: string | string[] | number | boolean | undefined): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value === 1;
  }

  if (typeof value === "string") {
    return value === "1" || value.toLowerCase() === "true";
  }

  if (Array.isArray(value)) {
    return value.some((entry) => asBoolean(entry));
  }

  return false;
}

function getRequestedModel(body: unknown) {
  if (!body || typeof body !== "object" || !("model" in body)) {
    return undefined;
  }

  const candidate = (body as { model?: unknown }).model;
  return typeof candidate === "string" ? candidate : undefined;
}

function findUnsupportedResponsesFeature(request: unknown) {
  if (!request || typeof request !== "object") {
    return null;
  }

  const rawRequest = request as Record<string, unknown>;
  const unsupportedFields: Array<{
    key: string;
    message: string;
  }> = [
    {
      key: "previous_response_id",
      message: "previous_response_id is not supported by this gateway yet."
    },
    {
      key: "store",
      message: "store is not supported by this gateway because stored response retrieval is not implemented."
    },
    {
      key: "prompt",
      message: "prompt is not supported by this gateway yet."
    },
    {
      key: "conversation",
      message: "conversation is not supported by this gateway yet."
    },
    {
      key: "include",
      message: "include is not supported by this gateway yet."
    },
    {
      key: "truncation",
      message: "truncation is not supported by this gateway yet."
    },
    {
      key: "max_tool_calls",
      message: "max_tool_calls is not supported by this gateway yet."
    }
  ];

  const unsupportedField = unsupportedFields.find((field) => rawRequest[field.key] !== undefined);

  if (!unsupportedField) {
    return null;
  }

  return invalidRequestError(unsupportedField.message, unsupportedField.key);
}
