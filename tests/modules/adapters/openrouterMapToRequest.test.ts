import { describe, expect, it } from "vitest";

import { mapToOpenRouterRequest } from "../../../src/modules/adapters/openrouter/mapToOpenRouterRequest.js";

describe("mapToOpenRouterRequest", () => {
  it("adds a strict output developer control message and clamps temperature when the user asks for exact output", () => {
    const result = mapToOpenRouterRequest({
      model: "auto:free",
      messages: [
        {
          role: "user",
          content: "请只回复 smoke-ok，不要输出其他内容。"
        }
      ]
    }, "stepfun/step-3.5-flash:free");

    expect(result).toMatchObject({
      model: "stepfun/step-3.5-flash:free",
      temperature: 0
    });
    expect(result.messages[0]).toMatchObject({
      role: "developer"
    });
    expect(typeof result.messages[0]?.content).toBe("string");
    expect(result.messages[0]?.content).toContain("Strict output mode");
    expect(result.messages[0]?.content).toContain("Exact reply: smoke-ok");
    expect(result.messages[1]).toMatchObject({
      role: "user",
      content: "请只回复 smoke-ok，不要输出其他内容。"
    });
  });

  it("does not override an explicit temperature when strict output mode is detected", () => {
    const result = mapToOpenRouterRequest({
      model: "auto:free",
      temperature: 0.4,
      messages: [
        {
          role: "developer",
          content: "Keep the answer brief."
        },
        {
          role: "user",
          content: "Only reply with smoke-ok."
        }
      ]
    }, "stepfun/step-3.5-flash:free");

    expect(result.temperature).toBe(0.4);
    expect(result.messages[0]).toMatchObject({
      role: "developer"
    });
    expect(result.messages[0]?.content).toContain("Strict output mode");
    expect(result.messages[0]?.content).toContain("Exact reply: smoke-ok");
    expect(result.messages[0]?.content).toContain("Keep the answer brief.");
  });

  it("leaves ordinary chat requests unchanged", () => {
    const result = mapToOpenRouterRequest({
      model: "auto:free",
      messages: [
        {
          role: "user",
          content: "Tell me a short joke."
        }
      ]
    }, "qwen/qwen3-next-80b-a3b-instruct:free");

    expect(result).toEqual({
      model: "qwen/qwen3-next-80b-a3b-instruct:free",
      messages: [
        {
          role: "user",
          content: "Tell me a short joke."
        }
      ]
    });
  });
});
