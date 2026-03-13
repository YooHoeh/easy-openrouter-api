import { TextDecoder } from "node:util";

import type { ChatCompletionResponse } from "../types/openai.js";

const DEFAULT_STREAM_CHUNK_SIZE = 24;

export interface StreamExecutionMetadata {
  selectedModel: string;
  actualModel: string;
  attemptedModels: string[];
  fallbackUsed: boolean;
}

type StreamSource = AsyncIterable<Uint8Array | string> | null | undefined;

export function createChatCompletionSseStream(
  response: ChatCompletionResponse,
  chunkSize = DEFAULT_STREAM_CHUNK_SIZE
): AsyncGenerator<string> {
  return streamChatCompletionResponse(response, chunkSize);
}

export function createStreamingDebugHeaders(
  metadata: StreamExecutionMetadata,
  debugEnabled: boolean
) {
  if (!debugEnabled) {
    return {};
  }

  return {
    "x-easyapi-selected-model": metadata.selectedModel,
    "x-easyapi-actual-model": metadata.actualModel,
    "x-easyapi-fallback-used": metadata.fallbackUsed ? "1" : "0",
    "x-easyapi-attempted-models": metadata.attemptedModels.join(",")
  };
}

export function rewriteOpenRouterSseStream(
  body: StreamSource,
  requestedModel: string
): AsyncGenerator<string> {
  return rewriteSseLines(body, requestedModel);
}

async function* streamChatCompletionResponse(
  response: ChatCompletionResponse,
  chunkSize: number
): AsyncGenerator<string> {
  for (const choice of response.choices) {
    yield toSseData({
      id: response.id,
      object: "chat.completion.chunk",
      created: response.created,
      model: response.model,
      choices: [
        {
          index: choice.index,
          delta: {
            role: choice.message.role
          },
          finish_reason: null
        }
      ]
    });

    const toolCalls = choice.message.tool_calls ?? [];

    for (const [toolCallIndex, toolCall] of toolCalls.entries()) {
      yield toSseData({
        id: response.id,
        object: "chat.completion.chunk",
        created: response.created,
        model: response.model,
        choices: [
          {
            index: choice.index,
            delta: {
              tool_calls: [
                {
                  index: toolCallIndex,
                  id: toolCall.id,
                  type: toolCall.type,
                  function: {
                    name: toolCall.function.name,
                    arguments: ""
                  }
                }
              ]
            },
            finish_reason: null
          }
        ]
      });

      for (const segment of splitContent(toolCall.function.arguments, chunkSize)) {
        if (segment.length === 0) {
          continue;
        }

        yield toSseData({
          id: response.id,
          object: "chat.completion.chunk",
          created: response.created,
          model: response.model,
          choices: [
            {
              index: choice.index,
              delta: {
                tool_calls: [
                  {
                    index: toolCallIndex,
                    function: {
                      arguments: segment
                    }
                  }
                ]
              },
              finish_reason: null
            }
          ]
        });
      }
    }

    for (const segment of splitContent(choice.message.content ?? "", chunkSize)) {
      if (segment.length === 0) {
        continue;
      }

      yield toSseData({
        id: response.id,
        object: "chat.completion.chunk",
        created: response.created,
        model: response.model,
        choices: [
          {
            index: choice.index,
            delta: {
              content: segment
            },
            finish_reason: null
          }
        ]
      });
    }

    yield toSseData({
      id: response.id,
      object: "chat.completion.chunk",
      created: response.created,
      model: response.model,
      choices: [
        {
          index: choice.index,
          delta: {},
          finish_reason: choice.finish_reason
        }
      ]
    });
  }

  yield "data: [DONE]\n\n";
}

async function* rewriteSseLines(body: StreamSource, requestedModel: string): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of iterateStreamSource(body)) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const rewrittenLine = rewriteSseLine(line, requestedModel);

      yield rewrittenLine.output;

      if (rewrittenLine.done) {
        return;
      }
    }
  }

  const finalChunk = decoder.decode();

  if (finalChunk) {
    buffer += finalChunk;
  }

  if (buffer.length > 0) {
    const trailingLines = buffer.split(/\r?\n/);

    for (const line of trailingLines) {
      const rewrittenLine = rewriteSseLine(line, requestedModel);

      yield rewrittenLine.output;

      if (rewrittenLine.done) {
        return;
      }
    }
  }
}

async function* iterateStreamSource(body: StreamSource): AsyncGenerator<Uint8Array | string> {
  if (!body) {
    return;
  }

  for await (const chunk of body) {
    yield chunk;
  }
}

function rewriteSseLine(line: string, requestedModel: string) {
  if (!line.startsWith("data: ")) {
    return {
      output: `${line}\n`,
      done: false
    };
  }

  const payload = line.slice("data: ".length);

  if (payload === "[DONE]") {
    return {
      output: "data: [DONE]\n\n",
      done: true
    };
  }

  try {
    const parsed = JSON.parse(payload);

    if (parsed && typeof parsed === "object") {
      return {
        output: `data: ${JSON.stringify({
          ...parsed,
          model: requestedModel
        })}\n`,
        done: false
      };
    }
  } catch {
    // Preserve the original line when upstream emits a non-JSON data frame.
  }

  return {
    output: `${line}\n`,
    done: false
  };
}

function toSseData(payload: Record<string, unknown>) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function splitContent(content: string, chunkSize: number) {
  if (content.length === 0) {
    return [""];
  }

  const segments: string[] = [];

  for (let index = 0; index < content.length; index += chunkSize) {
    segments.push(content.slice(index, index + chunkSize));
  }

  return segments;
}
