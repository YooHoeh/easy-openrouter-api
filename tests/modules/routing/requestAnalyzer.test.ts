import { describe, expect, it } from "vitest";

import { analyzeChatCompletionsRequest } from "../../../src/modules/routing/requestAnalyzer.js";

describe("analyzeChatCompletionsRequest", () => {
  it("normalizes a simple text request", () => {
    const analysis = analyzeChatCompletionsRequest({
      model: "auto:free",
      messages: [
        {
          role: "user",
          content: "Summarize this article."
        }
      ]
    });

    expect(analysis).toEqual({
      task_type: "general_chat",
      required_modalities: ["text"],
      required_features: [],
      preferred_context_length: 16000,
      allow_paid_fallback: false,
      debug: false
    });
  });

  it("detects coding requests from aliases and text hints", () => {
    const analysis = analyzeChatCompletionsRequest({
      model: "auto:coding",
      messages: [
        {
          role: "user",
          content: "Debug this Fastify handler and write a regression test."
        }
      ]
    });

    expect(analysis.task_type).toBe("coding");
    expect(analysis.required_modalities).toEqual(["text"]);
  });

  it("detects image requests and route features", () => {
    const analysis = analyzeChatCompletionsRequest(
      {
        model: "auto:free",
        stream: true,
        tools: [
          {
            type: "function",
            function: {
              name: "save_invoice"
            }
          }
        ],
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Read this invoice and extract the total amount."
              },
              {
                type: "image_url",
                image_url: {
                  url: "data:image/png;base64,abc"
                }
              }
            ]
          }
        ]
      },
      { debug: true }
    );

    expect(analysis).toMatchObject({
      task_type: "document_extraction",
      required_modalities: ["text", "image"],
      required_features: ["tools", "streaming"],
      preferred_context_length: 32000,
      debug: true
    });
  });

  it("detects audio requests and upgrades context when structured output is requested", () => {
    const analysis = analyzeChatCompletionsRequest({
      model: "auto:reasoning",
      response_format: {
        type: "json_schema",
        schema: {
          type: "object"
        }
      },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "input_audio",
              input_audio: {
                data: "ZmFrZQ==",
                format: "mp3"
              }
            }
          ]
        }
      ]
    });

    expect(analysis).toEqual({
      task_type: "audio_transcription",
      required_modalities: ["text", "audio"],
      required_features: ["response_format"],
      preferred_context_length: 32000,
      allow_paid_fallback: false,
      debug: false
    });
  });
});
