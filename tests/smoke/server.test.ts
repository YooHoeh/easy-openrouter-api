import { describe, expect, it } from "vitest";

import { buildApp } from "../../src/app/buildApp.js";

describe("server smoke test", () => {
  it("boots the Fastify application and serves health", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);

    await app.close();
  });
});
