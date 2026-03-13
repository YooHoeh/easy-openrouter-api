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
import { ChatCompletionsRequestSchema } from "../../modules/routing/requestSchemas.js";
import {
  buildRouteErrorDebugPayload
} from "../../modules/telemetry/debugRoutePayload.js";
import { buildStrictOutputShortcutResponse } from "../../modules/routing/strictOutput.js";
import { createChildLogger } from "../../modules/telemetry/logger.js";
import { logRequestRecord } from "../../modules/telemetry/requestLog.js";
import type {
  OpenAIErrorResponse
} from "../../types/openai.js";

interface ChatCompletionsQuerystring {
  debug?: string | number | boolean;
}

interface ChatCompletionsRouteOptions {
  services: EasyApiServices;
  env: Env;
}

export const registerChatCompletionsRoutes: FastifyPluginAsync<ChatCompletionsRouteOptions> = async (
  app,
  options
) => {
  app.post("/v1/chat/completions", async (request, reply) => {
    const startedAt = Date.now();
    const logger = createChildLogger(app.log, {
      request_id: request.id,
      route: "/v1/chat/completions"
    });
    const requestedModel = getRequestedModel(request.body);
    const debug = options.env.ENABLE_DEBUG_ROUTE_METADATA || isDebugEnabled(
      (request.query as ChatCompletionsQuerystring | undefined)?.debug,
      request.headers["x-easyapi-debug"]
    );

    const parsedRequest = ChatCompletionsRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      const error = invalidRequestError("Invalid chat completions request body.");
      await logRequestRecord(logger, {
        request_id: request.id,
        route: "/v1/chat/completions",
        route_mode: "validation",
        success: false,
        error_code: error.code,
        latency_ms: Date.now() - startedAt,
        ...(requestedModel ? { requested_model: requestedModel } : {})
      }, options.services.requestTelemetrySink);
      return reply.status(error.statusCode).send(toOpenAIErrorResponse(error));
    }

    const strictOutputShortcut = buildStrictOutputShortcutResponse(parsedRequest.data);

    if (strictOutputShortcut) {
      if (parsedRequest.data.stream) {
        await logRequestRecord(logger, {
          request_id: request.id,
          route: "/v1/chat/completions",
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

        return reply.send(Readable.from(createChatCompletionSseStream(strictOutputShortcut.response)));
      }

      const response = strictOutputShortcut.response;

      if (debug) {
        response.route = strictOutputShortcut.route;
      }

      await logRequestRecord(logger, {
        request_id: request.id,
        route: "/v1/chat/completions",
        requested_model: parsedRequest.data.model,
        route_mode: "shortcut",
        success: true,
        latency_ms: Date.now() - startedAt
      }, options.services.requestTelemetrySink);

      return reply.status(200).send(response);
    }

    const preparation = await prepareChatRequestExecution({
      request: parsedRequest.data,
      services: options.services,
      debug,
      allowPaidFallback: options.env.ALLOW_PAID_FALLBACK,
      enableExplicitModelRuntimeFallback: options.env.ENABLE_EXPLICIT_MODEL_RUNTIME_FALLBACK
    });

    if (!preparation.ok) {
      await logRequestRecord(logger, {
        request_id: request.id,
        route: "/v1/chat/completions",
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
        route: "/v1/chat/completions",
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
          route: "/v1/chat/completions",
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

        return reply.send(Readable.from(execution.stream));
      }

      const execution = await executePreparedChatRequest(
        preparation.prepared,
        options.services.executionClient
      );
      const response = execution.response;

      if (debug) {
        response.route = buildSuccessfulRouteDebugPayload(executionTarget, execution);
      }

      await logRequestRecord(logger, {
        request_id: request.id,
        route: "/v1/chat/completions",
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
        route: "/v1/chat/completions",
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
  debugQueryValue: ChatCompletionsQuerystring["debug"],
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
