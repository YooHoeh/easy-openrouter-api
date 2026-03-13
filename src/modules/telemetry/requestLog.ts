import type { EasyApiLogger } from "./logger.js";
import type { RequestTelemetrySink } from "./requestTelemetrySink.js";

export interface RequestLogRecord {
  event: "gateway_request";
  request_id: string;
  route: string;
  requested_model?: string;
  selected_model?: string;
  actual_model?: string;
  selected_preprocessors: string[];
  route_mode: string;
  fallback_used: boolean;
  success: boolean;
  error_code?: string;
  latency_ms: number;
}

export interface RequestLogInput {
  request_id: string;
  route: string;
  requested_model?: string;
  selected_model?: string;
  actual_model?: string;
  selected_preprocessors?: string[];
  route_mode: string;
  fallback_used?: boolean;
  success: boolean;
  error_code?: string;
  latency_ms: number;
}

export function buildRequestLogRecord(input: RequestLogInput): RequestLogRecord {
  return {
    event: "gateway_request",
    request_id: input.request_id,
    route: input.route,
    route_mode: input.route_mode,
    selected_preprocessors: input.selected_preprocessors ?? [],
    fallback_used: input.fallback_used ?? false,
    success: input.success,
    latency_ms: input.latency_ms,
    ...(input.requested_model ? { requested_model: input.requested_model } : {}),
    ...(input.selected_model ? { selected_model: input.selected_model } : {}),
    ...(input.actual_model ? { actual_model: input.actual_model } : {}),
    ...(input.error_code ? { error_code: input.error_code } : {})
  };
}

export async function logRequestRecord(
  logger: EasyApiLogger,
  input: RequestLogInput,
  sink?: RequestTelemetrySink | null
) {
  const record = buildRequestLogRecord(input);

  if (record.success) {
    logger.info(record, "Gateway request completed");
  } else {
    logger.error(record, "Gateway request failed");
  }

  if (!sink) {
    return record;
  }

  try {
    await sink.write(record);
  } catch (cause) {
    logger.warn({
      request_id: record.request_id,
      route: record.route,
      sink: "request_telemetry",
      error: cause instanceof Error ? cause.message : String(cause)
    }, "Failed to persist request telemetry");
  }

  return record;
}
