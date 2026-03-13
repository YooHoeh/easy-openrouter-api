import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { loadProcessEnvFiles, parseEnv } from "../../src/config/env.js";

describe("parseEnv", () => {
  it("applies stable defaults", () => {
    expect(parseEnv({})).toEqual({
      HOST: "0.0.0.0",
      PORT: 3000,
      LOG_LEVEL: "info",
      ENABLE_DEBUG_ROUTE_METADATA: false,
      ALLOW_PAID_FALLBACK: false,
      ENABLE_EXPLICIT_MODEL_RUNTIME_FALLBACK: false
    });
  });

  it("parses booleans, ports, and optional api keys", () => {
    expect(
      parseEnv({
        HOST: "127.0.0.1",
        PORT: "4321",
        LOG_LEVEL: "debug",
        ENABLE_DEBUG_ROUTE_METADATA: "true",
        ALLOW_PAID_FALLBACK: "1",
        ENABLE_EXPLICIT_MODEL_RUNTIME_FALLBACK: "yes",
        TELEMETRY_REQUEST_LOG_PATH: ".logs/requests.ndjson",
        OPENROUTER_API_KEY: "test-key"
      })
    ).toEqual({
      HOST: "127.0.0.1",
      PORT: 4321,
      LOG_LEVEL: "debug",
      ENABLE_DEBUG_ROUTE_METADATA: true,
      ALLOW_PAID_FALLBACK: true,
      ENABLE_EXPLICIT_MODEL_RUNTIME_FALLBACK: true,
      TELEMETRY_REQUEST_LOG_PATH: ".logs/requests.ndjson",
      OPENROUTER_API_KEY: "test-key"
    });
  });

  it("loads .env files without overriding existing shell variables", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "easy-api-env-"));

    try {
      writeFileSync(
        path.join(tempDir, ".env"),
        [
          "HOST=0.0.0.0",
          "PORT=4000",
          "LOG_LEVEL=info",
          "OPENROUTER_API_KEY=from-dotenv"
        ].join("\n")
      );
      writeFileSync(
        path.join(tempDir, ".env.local"),
        [
          "LOG_LEVEL=trace",
          "ENABLE_DEBUG_ROUTE_METADATA=true",
          "ENABLE_EXPLICIT_MODEL_RUNTIME_FALLBACK=1",
          "TELEMETRY_REQUEST_LOG_PATH=.logs/requests.ndjson"
        ].join("\n")
      );

      const targetEnv: Record<string, string | undefined> = {
        PORT: "5000"
      };
      const loadedFiles = loadProcessEnvFiles({
        cwd: tempDir,
        targetEnv
      });

      expect(loadedFiles).toHaveLength(2);
      expect(targetEnv).toEqual({
        HOST: "0.0.0.0",
        PORT: "5000",
        LOG_LEVEL: "trace",
        ENABLE_DEBUG_ROUTE_METADATA: "true",
        ENABLE_EXPLICIT_MODEL_RUNTIME_FALLBACK: "1",
        TELEMETRY_REQUEST_LOG_PATH: ".logs/requests.ndjson",
        OPENROUTER_API_KEY: "from-dotenv"
      });
    } finally {
      rmSync(tempDir, {
        force: true,
        recursive: true
      });
    }
  });
});
