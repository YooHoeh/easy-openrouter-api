import { describe, expect, it, vi } from "vitest";

import { buildRequestLogRecord, logRequestRecord } from "../../../src/modules/telemetry/requestLog.js";

describe("requestLog", () => {
  it("builds a stable structured request log record", () => {
    expect(
      buildRequestLogRecord({
        request_id: "req_123",
        route: "/v1/chat/completions",
        requested_model: "auto:free",
        selected_model: "qwen/qwen3-coder:free",
        route_mode: "direct",
        success: true,
        latency_ms: 42
      })
    ).toEqual({
      event: "gateway_request",
      request_id: "req_123",
      route: "/v1/chat/completions",
      requested_model: "auto:free",
      selected_model: "qwen/qwen3-coder:free",
      selected_preprocessors: [],
      route_mode: "direct",
      fallback_used: false,
      success: true,
      latency_ms: 42
    });
  });

  it("logs failures through the error channel", async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn()
    };

    const record = await logRequestRecord(logger, {
      request_id: "req_456",
      route: "/v1/chat/completions",
      requested_model: "auto:vision",
      route_mode: "unavailable",
      success: false,
      error_code: "no_eligible_model",
      latency_ms: 15
    });

    expect(record.error_code).toBe("no_eligible_model");
    expect(logger.error).toHaveBeenCalledWith(record, "Gateway request failed");
  });

  it("persists the structured record into an injected telemetry sink", async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn()
    };
    const sink = {
      write: vi.fn().mockResolvedValue(undefined)
    };

    const record = await logRequestRecord(logger, {
      request_id: "req_789",
      route: "/v1/responses",
      requested_model: "auto:free",
      route_mode: "direct",
      success: true,
      latency_ms: 8
    }, sink);

    expect(sink.write).toHaveBeenCalledWith(record);
    expect(record.event).toBe("gateway_request");
    expect(logger.info).toHaveBeenCalledWith(record, "Gateway request completed");
  });
});
