import type { RequestLogRecord } from "./requestLog.js";
import type { RequestTelemetrySink } from "./requestTelemetrySink.js";

export interface RequestMetricsBucket {
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  fallback_requests: number;
  average_latency_ms: number;
  max_latency_ms: number;
}

export interface RequestMetricsRouteEntry extends RequestMetricsBucket {
  route: string;
}

export interface RequestMetricsCountEntry {
  id: string;
  count: number;
}

export interface RequestMetricsSummary {
  object: "easyapi.metrics";
  window: {
    process_started_at: string;
    last_request_at?: string;
  };
  totals: RequestMetricsBucket;
  routes: RequestMetricsRouteEntry[];
  route_modes: RequestMetricsCountEntry[];
  error_codes: RequestMetricsCountEntry[];
}

export interface RequestMetricsPrometheusOptions {
  generated_at?: Date;
}

interface MutableRequestMetricsBucket {
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  fallback_requests: number;
  latency_sum_ms: number;
  max_latency_ms: number;
}

export interface RequestMetricsCollector extends RequestTelemetrySink {
  getSummary(): RequestMetricsSummary;
}

export class InMemoryRequestMetricsCollector implements RequestMetricsCollector {
  private readonly processStartedAt = new Date().toISOString();
  private lastRequestAt: string | null = null;
  private readonly totals = createMutableBucket();
  private readonly routes = new Map<string, MutableRequestMetricsBucket>();
  private readonly routeModes = new Map<string, number>();
  private readonly errorCodes = new Map<string, number>();

  async write(record: RequestLogRecord) {
    this.lastRequestAt = new Date().toISOString();
    updateMutableBucket(this.totals, record);
    updateMutableBucket(getOrCreateRouteBucket(this.routes, record.route), record);
    incrementCount(this.routeModes, record.route_mode);

    if (record.error_code) {
      incrementCount(this.errorCodes, record.error_code);
    }
  }

  getSummary(): RequestMetricsSummary {
    return {
      object: "easyapi.metrics",
      window: {
        process_started_at: this.processStartedAt,
        ...(this.lastRequestAt ? { last_request_at: this.lastRequestAt } : {})
      },
      totals: finalizeBucket(this.totals),
      routes: [...this.routes.entries()]
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([route, bucket]) => ({
          route,
          ...finalizeBucket(bucket)
        })),
      route_modes: finalizeCounts(this.routeModes),
      error_codes: finalizeCounts(this.errorCodes)
    };
  }
}

function createMutableBucket(): MutableRequestMetricsBucket {
  return {
    total_requests: 0,
    successful_requests: 0,
    failed_requests: 0,
    fallback_requests: 0,
    latency_sum_ms: 0,
    max_latency_ms: 0
  };
}

function getOrCreateRouteBucket(
  routes: Map<string, MutableRequestMetricsBucket>,
  route: string
) {
  const existing = routes.get(route);

  if (existing) {
    return existing;
  }

  const created = createMutableBucket();
  routes.set(route, created);
  return created;
}

function updateMutableBucket(bucket: MutableRequestMetricsBucket, record: RequestLogRecord) {
  bucket.total_requests += 1;
  bucket.latency_sum_ms += record.latency_ms;
  bucket.max_latency_ms = Math.max(bucket.max_latency_ms, record.latency_ms);

  if (record.success) {
    bucket.successful_requests += 1;
  } else {
    bucket.failed_requests += 1;
  }

  if (record.fallback_used) {
    bucket.fallback_requests += 1;
  }
}

function finalizeBucket(bucket: MutableRequestMetricsBucket): RequestMetricsBucket {
  return {
    total_requests: bucket.total_requests,
    successful_requests: bucket.successful_requests,
    failed_requests: bucket.failed_requests,
    fallback_requests: bucket.fallback_requests,
    average_latency_ms:
      bucket.total_requests === 0
        ? 0
        : roundMetric(bucket.latency_sum_ms / bucket.total_requests),
    max_latency_ms: bucket.max_latency_ms
  };
}

function incrementCount(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function finalizeCounts(counts: Map<string, number>): RequestMetricsCountEntry[] {
  return [...counts.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([id, count]) => ({
      id,
      count
    }));
}

function roundMetric(value: number) {
  return Math.round(value * 100) / 100;
}

export function formatRequestMetricsPrometheus(
  summary: RequestMetricsSummary,
  options: RequestMetricsPrometheusOptions = {}
) {
  const generatedAt = options.generated_at ?? new Date();
  const lines: string[] = [
    "# HELP easyapi_metrics_generated_at_unix_seconds Unix timestamp when the metrics document was generated.",
    "# TYPE easyapi_metrics_generated_at_unix_seconds gauge",
    `easyapi_metrics_generated_at_unix_seconds ${toUnixSeconds(generatedAt.toISOString())}`,
    "# HELP easyapi_process_started_at_unix_seconds Unix timestamp when the current process started.",
    "# TYPE easyapi_process_started_at_unix_seconds gauge",
    `easyapi_process_started_at_unix_seconds ${toUnixSeconds(summary.window.process_started_at)}`,
    "# HELP easyapi_requests_total Total gateway requests recorded by the current process.",
    "# TYPE easyapi_requests_total counter",
    `easyapi_requests_total ${summary.totals.total_requests}`,
    "# HELP easyapi_requests_successful_total Total successful gateway requests recorded by the current process.",
    "# TYPE easyapi_requests_successful_total counter",
    `easyapi_requests_successful_total ${summary.totals.successful_requests}`,
    "# HELP easyapi_requests_failed_total Total failed gateway requests recorded by the current process.",
    "# TYPE easyapi_requests_failed_total counter",
    `easyapi_requests_failed_total ${summary.totals.failed_requests}`,
    "# HELP easyapi_requests_fallback_total Total gateway requests that used fallback execution.",
    "# TYPE easyapi_requests_fallback_total counter",
    `easyapi_requests_fallback_total ${summary.totals.fallback_requests}`,
    "# HELP easyapi_request_latency_average_ms Average request latency in milliseconds for the current process window.",
    "# TYPE easyapi_request_latency_average_ms gauge",
    `easyapi_request_latency_average_ms ${summary.totals.average_latency_ms}`,
    "# HELP easyapi_request_latency_max_ms Max request latency in milliseconds for the current process window.",
    "# TYPE easyapi_request_latency_max_ms gauge",
    `easyapi_request_latency_max_ms ${summary.totals.max_latency_ms}`
  ];

  if (summary.window.last_request_at) {
    lines.push(
      "# HELP easyapi_last_request_at_unix_seconds Unix timestamp of the latest recorded gateway request.",
      "# TYPE easyapi_last_request_at_unix_seconds gauge",
      `easyapi_last_request_at_unix_seconds ${toUnixSeconds(summary.window.last_request_at)}`
    );
  }

  lines.push(
    "# HELP easyapi_route_requests_total Total gateway requests grouped by route.",
    "# TYPE easyapi_route_requests_total counter"
  );

  for (const route of summary.routes) {
    lines.push(
      `easyapi_route_requests_total{route="${escapePrometheusLabelValue(route.route)}"} ${route.total_requests}`,
      `easyapi_route_requests_successful_total{route="${escapePrometheusLabelValue(route.route)}"} ${route.successful_requests}`,
      `easyapi_route_requests_failed_total{route="${escapePrometheusLabelValue(route.route)}"} ${route.failed_requests}`,
      `easyapi_route_requests_fallback_total{route="${escapePrometheusLabelValue(route.route)}"} ${route.fallback_requests}`,
      `easyapi_route_request_latency_average_ms{route="${escapePrometheusLabelValue(route.route)}"} ${route.average_latency_ms}`,
      `easyapi_route_request_latency_max_ms{route="${escapePrometheusLabelValue(route.route)}"} ${route.max_latency_ms}`
    );
  }

  lines.push(
    "# HELP easyapi_route_mode_total Total gateway requests grouped by route mode.",
    "# TYPE easyapi_route_mode_total counter"
  );

  for (const routeMode of summary.route_modes) {
    lines.push(
      `easyapi_route_mode_total{route_mode="${escapePrometheusLabelValue(routeMode.id)}"} ${routeMode.count}`
    );
  }

  lines.push(
    "# HELP easyapi_error_code_total Total failed gateway requests grouped by error code.",
    "# TYPE easyapi_error_code_total counter"
  );

  for (const errorCode of summary.error_codes) {
    lines.push(
      `easyapi_error_code_total{error_code="${escapePrometheusLabelValue(errorCode.id)}"} ${errorCode.count}`
    );
  }

  return `${lines.join("\n")}\n`;
}

function toUnixSeconds(isoTimestamp: string) {
  return Math.floor(new Date(isoTimestamp).getTime() / 1000);
}

function escapePrometheusLabelValue(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, "\\\"");
}
