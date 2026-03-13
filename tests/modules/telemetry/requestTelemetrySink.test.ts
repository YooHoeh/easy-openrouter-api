import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { FileRequestTelemetrySink } from "../../../src/modules/telemetry/requestTelemetrySink.js";

describe("requestTelemetrySink", () => {
  it("appends request records as ndjson lines", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "easy-api-telemetry-"));
    const filePath = path.join(tempDir, "requests.ndjson");
    const sink = new FileRequestTelemetrySink(filePath);

    try {
      await sink.write({
        event: "gateway_request",
        request_id: "req_1",
        route: "/v1/chat/completions",
        requested_model: "auto:free",
        selected_preprocessors: [],
        route_mode: "direct",
        fallback_used: false,
        success: true,
        latency_ms: 12
      });
      await sink.write({
        event: "gateway_request",
        request_id: "req_2",
        route: "/v1/responses",
        selected_preprocessors: ["google/gemma-3-27b-it:free"],
        route_mode: "orchestrated",
        fallback_used: true,
        success: false,
        error_code: "upstream_unavailable",
        latency_ms: 27
      });

      const lines = readFileSync(filePath, "utf8")
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line) as Record<string, unknown>);

      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatchObject({
        request_id: "req_1",
        route: "/v1/chat/completions",
        success: true
      });
      expect(lines[1]).toMatchObject({
        request_id: "req_2",
        route: "/v1/responses",
        error_code: "upstream_unavailable"
      });
    } finally {
      rmSync(tempDir, {
        recursive: true,
        force: true
      });
    }
  });
});
