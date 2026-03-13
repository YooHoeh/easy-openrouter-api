import { describe, expect, it } from "vitest";

import {
  formatRequestMetricsPrometheus,
  InMemoryRequestMetricsCollector
} from "../../../src/modules/telemetry/requestMetrics.js";

describe("requestMetrics", () => {
  it("returns a stable empty summary before any request is recorded", () => {
    const collector = new InMemoryRequestMetricsCollector();

    expect(collector.getSummary()).toMatchObject({
      object: "easyapi.metrics",
      window: {
        process_started_at: expect.any(String)
      },
      totals: {
        total_requests: 0,
        successful_requests: 0,
        failed_requests: 0,
        fallback_requests: 0,
        average_latency_ms: 0,
        max_latency_ms: 0
      },
      routes: [],
      route_modes: [],
      error_codes: []
    });
  });

  it("aggregates totals, routes, route modes, and error codes", async () => {
    const collector = new InMemoryRequestMetricsCollector();

    await collector.write({
      event: "gateway_request",
      request_id: "req_1",
      route: "/v1/chat/completions",
      requested_model: "auto:free",
      selected_preprocessors: [],
      route_mode: "direct",
      fallback_used: false,
      success: true,
      latency_ms: 10
    });
    await collector.write({
      event: "gateway_request",
      request_id: "req_2",
      route: "/v1/chat/completions",
      requested_model: "auto:reasoning",
      selected_preprocessors: ["google/gemma-3-27b-it:free"],
      route_mode: "orchestrated",
      fallback_used: true,
      success: false,
      error_code: "upstream_timeout",
      latency_ms: 30
    });
    await collector.write({
      event: "gateway_request",
      request_id: "req_3",
      route: "/v1/responses",
      requested_model: "auto:free",
      selected_preprocessors: [],
      route_mode: "direct",
      fallback_used: false,
      success: true,
      latency_ms: 20
    });

    expect(collector.getSummary()).toMatchObject({
      object: "easyapi.metrics",
      window: {
        process_started_at: expect.any(String),
        last_request_at: expect.any(String)
      },
      totals: {
        total_requests: 3,
        successful_requests: 2,
        failed_requests: 1,
        fallback_requests: 1,
        average_latency_ms: 20,
        max_latency_ms: 30
      },
      routes: [
        {
          route: "/v1/chat/completions",
          total_requests: 2,
          successful_requests: 1,
          failed_requests: 1,
          fallback_requests: 1,
          average_latency_ms: 20,
          max_latency_ms: 30
        },
        {
          route: "/v1/responses",
          total_requests: 1,
          successful_requests: 1,
          failed_requests: 0,
          fallback_requests: 0,
          average_latency_ms: 20,
          max_latency_ms: 20
        }
      ],
      route_modes: [
        {
          id: "direct",
          count: 2
        },
        {
          id: "orchestrated",
          count: 1
        }
      ],
      error_codes: [
        {
          id: "upstream_timeout",
          count: 1
        }
      ]
    });
  });

  it("formats a prometheus text document from the current summary", async () => {
    const collector = new InMemoryRequestMetricsCollector();

    await collector.write({
      event: "gateway_request",
      request_id: "req_prom",
      route: "/v1/chat/completions",
      requested_model: "auto:free",
      selected_preprocessors: [],
      route_mode: "direct",
      fallback_used: false,
      success: true,
      latency_ms: 12
    });

    const body = formatRequestMetricsPrometheus(collector.getSummary(), {
      generated_at: new Date("2026-03-13T13:45:00.000Z")
    });
    const generatedAtUnixSeconds = Math.floor(new Date("2026-03-13T13:45:00.000Z").getTime() / 1000);

    expect(body).toContain("# HELP easyapi_requests_total");
    expect(body).toContain("easyapi_requests_total 1");
    expect(body).toContain("easyapi_route_requests_total{route=\"/v1/chat/completions\"} 1");
    expect(body).toContain("easyapi_route_mode_total{route_mode=\"direct\"} 1");
    expect(body).toContain(`easyapi_metrics_generated_at_unix_seconds ${generatedAtUnixSeconds}`);
  });
});
