import type { OpenAIErrorResponse } from "../types/openai.js";

export type EasyApiErrorCode =
  | "invalid_request"
  | "no_eligible_model"
  | "capability_unavailable"
  | "paid_fallback_disabled"
  | "upstream_timeout"
  | "upstream_unavailable";

export class EasyApiError extends Error {
  readonly code: EasyApiErrorCode;
  readonly statusCode: number;
  readonly type: OpenAIErrorResponse["error"]["type"];
  readonly param: string | null | undefined;

  constructor(options: {
    code: EasyApiErrorCode;
    message: string;
    statusCode: number;
    type?: OpenAIErrorResponse["error"]["type"];
    param?: string | null;
    cause?: unknown;
  }) {
    super(options.message, options.cause ? { cause: options.cause } : undefined);
    this.name = "EasyApiError";
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.type = options.type ?? "api_error";
    this.param = options.param;
  }
}

export function invalidRequestError(message: string, param?: string | null) {
  return new EasyApiError({
    code: "invalid_request",
    message,
    statusCode: 400,
    type: "invalid_request_error",
    ...(param !== undefined ? { param } : {})
  });
}

export function noEligibleModelError(message: string) {
  return new EasyApiError({
    code: "no_eligible_model",
    message,
    statusCode: 503
  });
}

export function capabilityUnavailableError(message: string, cause?: unknown) {
  return new EasyApiError({
    code: "capability_unavailable",
    message,
    statusCode: 422,
    ...(cause !== undefined ? { cause } : {})
  });
}

export function upstreamUnavailableError(message: string, cause?: unknown) {
  return new EasyApiError({
    code: "upstream_unavailable",
    message,
    statusCode: 503,
    ...(cause !== undefined ? { cause } : {})
  });
}

export function upstreamTimeoutError(message: string, cause?: unknown) {
  return new EasyApiError({
    code: "upstream_timeout",
    message,
    statusCode: 504,
    ...(cause !== undefined ? { cause } : {})
  });
}

export function toOpenAIErrorResponse(error: EasyApiError): OpenAIErrorResponse {
  return {
    error: {
      message: error.message,
      type: error.type,
      code: error.code,
      ...(error.param !== undefined ? { param: error.param } : {})
    }
  };
}

export function normalizeError(error: unknown): EasyApiError {
  if (error instanceof EasyApiError) {
    return error;
  }

  if (error instanceof Error) {
    if (error.name === "AbortError" || /timeout/i.test(error.message)) {
      return upstreamTimeoutError(error.message, error);
    }

    return upstreamUnavailableError(error.message, error);
  }

  return upstreamUnavailableError("An unexpected upstream error occurred.", error);
}
