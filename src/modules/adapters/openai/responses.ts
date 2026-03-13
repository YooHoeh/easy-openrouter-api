import type {
  ChatCompletionResponse,
  ResponsesResponse
} from "../../../types/openai.js";
import type {
  ParsedChatCompletionsRequest,
  ParsedResponsesRequest
} from "../../routing/requestSchemas.js";

type ParsedResponsesMessage = Exclude<ParsedResponsesRequest["input"], string>[number];
type ParsedResponsesContentPart = Extract<ParsedResponsesMessage["content"], unknown[]>[number];
interface ChatChunkToolCallDelta {
  index: number;
  id: string | undefined;
  name: string | undefined;
  arguments: string;
}

export function mapResponsesRequestToChatRequest(
  request: ParsedResponsesRequest
): ParsedChatCompletionsRequest {
  return {
    model: request.model,
    messages: [
      ...(request.instructions
        ? [
            {
              role: "developer" as const,
              content: request.instructions
            }
          ]
        : []),
      ...mapResponsesInputToMessages(request.input)
    ],
    ...(request.tools ? { tools: request.tools } : {}),
    ...(request.tool_choice !== undefined
      ? { tool_choice: normalizeToolChoice(request.tool_choice) }
      : {}),
    ...(request.parallel_tool_calls !== undefined
      ? { parallel_tool_calls: request.parallel_tool_calls }
      : {}),
    ...(request.stream !== undefined ? { stream: request.stream } : {}),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.top_p !== undefined ? { top_p: request.top_p } : {}),
    ...(request.stop !== undefined ? { stop: request.stop } : {}),
    ...(request.presence_penalty !== undefined
      ? { presence_penalty: request.presence_penalty }
      : {}),
    ...(request.frequency_penalty !== undefined
      ? { frequency_penalty: request.frequency_penalty }
      : {}),
    ...(request.seed !== undefined ? { seed: request.seed } : {}),
    ...(request.metadata ? { metadata: request.metadata } : {}),
    ...(request.text?.format ? { response_format: request.text.format } : {}),
    ...(request.max_output_tokens ? { max_tokens: request.max_output_tokens } : {}),
    ...(request.user ? { user: request.user } : {})
  };
}

export function mapChatResponseToResponsesResponse(
  response: ChatCompletionResponse
): ResponsesResponse {
  const responseId = toResponseId(response.id);
  const output = buildResponsesOutput(response, responseId);

  return {
    id: responseId,
    object: "response",
    created_at: response.created,
    status: "completed",
    model: response.model,
    output,
    usage: {
      input_tokens: response.usage.prompt_tokens,
      output_tokens: response.usage.completion_tokens,
      total_tokens: response.usage.total_tokens
    },
    ...(response.route ? { route: response.route } : {})
  };
}

export async function* createResponsesSseStreamFromChatStream(
  stream: AsyncIterable<string>,
  requestedModel: string
): AsyncGenerator<string> {
  let buffer = "";
  let responseId = `resp_${Date.now()}`;
  let createdAt = Math.floor(Date.now() / 1000);
  let accumulatedText = "";
  const toolCallStates = new Map<number, {
    id: string;
    name: string;
    arguments: string;
    added: boolean;
  }>();
  let completed = false;

  yield toSseEvent("response.created", {
    type: "response.created",
    response: {
      id: responseId,
      object: "response",
      created_at: createdAt,
      status: "in_progress",
      model: requestedModel
    }
  });

  for await (const chunk of stream) {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) {
        continue;
      }

      const payload = line.slice("data: ".length);

      if (payload === "[DONE]") {
        if (!completed) {
          yield createResponsesCompletionEvents(
            responseId,
            requestedModel,
            createdAt,
            accumulatedText,
            Array.from(toolCallStates.entries())
              .sort((left, right) => left[0] - right[0])
              .map(([, state]) => state)
          );
          completed = true;
        }
        return;
      }

      const parsed = safeJsonParse(payload);

      if (!parsed || typeof parsed !== "object") {
        continue;
      }

      const parsedRecord = parsed as Record<string, unknown>;

      const delta = extractChatChunkDelta(parsedRecord);

      if (delta) {
        accumulatedText += delta;
        yield toSseEvent("response.output_text.delta", {
          type: "response.output_text.delta",
          response_id: responseId,
          output_index: 0,
          content_index: 0,
          delta
        });
      }

      for (const toolCallDelta of extractChatChunkToolCalls(parsedRecord)) {
        const currentState = toolCallStates.get(toolCallDelta.index) ?? {
          id: toolCallDelta.id ?? `call_${toolCallDelta.index}`,
          name: toolCallDelta.name ?? "unknown_function",
          arguments: "",
          added: false
        };

        if (toolCallDelta.id) {
          currentState.id = toolCallDelta.id;
        }

        if (toolCallDelta.name) {
          currentState.name = toolCallDelta.name;
        }

        if (!currentState.added) {
          yield toSseEvent("response.output_item.added", {
            type: "response.output_item.added",
            response_id: responseId,
            output_index: toolCallDelta.index,
            item: {
              id: currentState.id,
              type: "function_call",
              status: "in_progress",
              call_id: currentState.id,
              name: currentState.name,
              arguments: currentState.arguments
            }
          });
          currentState.added = true;
        }

        if (toolCallDelta.arguments) {
          currentState.arguments += toolCallDelta.arguments;
          yield toSseEvent("response.function_call_arguments.delta", {
            type: "response.function_call_arguments.delta",
            response_id: responseId,
            item_id: currentState.id,
            output_index: toolCallDelta.index,
            delta: toolCallDelta.arguments
          });
        }

        toolCallStates.set(toolCallDelta.index, currentState);
      }

      if (hasFinishReason(parsedRecord) && !completed) {
        yield createResponsesCompletionEvents(
          responseId,
          requestedModel,
          createdAt,
          accumulatedText,
          Array.from(toolCallStates.entries())
            .sort((left, right) => left[0] - right[0])
            .map(([, state]) => state)
        );
        completed = true;
      }
    }
  }

  if (!completed) {
    yield createResponsesCompletionEvents(
      responseId,
      requestedModel,
      createdAt,
      accumulatedText,
      Array.from(toolCallStates.entries())
        .sort((left, right) => left[0] - right[0])
        .map(([, state]) => state)
    );
  }
}

function mapResponsesInputToMessages(input: ParsedResponsesRequest["input"]) {
  if (typeof input === "string") {
    return [
      {
        role: "user" as const,
        content: input
      }
    ];
  }

  return input.map((message) => mapResponsesInputMessage(message));
}

function mapResponsesInputMessage(message: ParsedResponsesMessage) {
  const mappedMessage = {
    role: message.role,
    ...(message.name ? { name: message.name } : {}),
    ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
    ...(message.tool_calls ? { tool_calls: message.tool_calls } : {})
  };

  if (typeof message.content === "string" || message.content === null) {
    return {
      ...mappedMessage,
      content: message.content
    };
  }

  return {
    ...mappedMessage,
    content: message.content.map((part) => mapResponsesInputPart(part))
  };
}

function mapResponsesInputPart(part: ParsedResponsesContentPart) {
  if (part.type === "input_text") {
    return {
      type: "text" as const,
      text: part.text
    };
  }

  if (part.type === "input_image") {
    const imageUrl = part.image_url;

    if (typeof imageUrl === "string") {
      return {
        type: "image_url" as const,
        image_url: {
          url: imageUrl
        }
      };
    }

    return {
      type: "image_url" as const,
      image_url: {
        url: imageUrl.url,
        ...(imageUrl.detail ? { detail: imageUrl.detail } : {})
      }
    };
  }

  return {
    ...part
  };
}

function normalizeToolChoice(toolChoice: NonNullable<ParsedResponsesRequest["tool_choice"]>) {
  if (typeof toolChoice === "string") {
    return toolChoice;
  }

  if ("function" in toolChoice) {
    return toolChoice;
  }

  const { name, ...rest } = toolChoice;

  return {
    ...rest,
    type: "function" as const,
    function: {
      name
    }
  };
}

function buildResponsesOutput(response: ChatCompletionResponse, responseId: string) {
  const primaryChoice = response.choices[0];
  const toolCalls = primaryChoice?.message.tool_calls ?? [];
  const output: ResponsesResponse["output"] = [];

  if (toolCalls.length > 0) {
    output.push(...toolCalls.map((toolCall) => ({
      id: toolCall.id,
      type: "function_call" as const,
      status: "completed" as const,
      call_id: toolCall.id,
      name: toolCall.function.name,
      arguments: toolCall.function.arguments
    })));
  }

  if (typeof primaryChoice?.message.content === "string") {
    output.push({
      id: toMessageId(responseId),
      type: "message" as const,
      status: "completed" as const,
      role: "assistant" as const,
      content: [
        {
          type: "output_text" as const,
          text: primaryChoice.message.content,
          annotations: []
        }
      ]
    });
  }

  if (output.length > 0) {
    return output;
  }

  return [
    {
      id: toMessageId(responseId),
      type: "message" as const,
      status: "completed" as const,
      role: "assistant" as const,
      content: [
        {
          type: "output_text" as const,
          text: "",
          annotations: []
        }
      ]
    }
  ];
}

function createResponsesCompletionEvents(
  responseId: string,
  requestedModel: string,
  createdAt: number,
  accumulatedText: string,
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: string;
  }>
) {
  const completionEvents: string[] = [];

  for (const [index, toolCall] of toolCalls.entries()) {
    completionEvents.push(
      toSseEvent("response.function_call_arguments.done", {
        type: "response.function_call_arguments.done",
        response_id: responseId,
        item_id: toolCall.id,
        output_index: index,
        arguments: toolCall.arguments
      })
    );
    completionEvents.push(
      toSseEvent("response.output_item.done", {
        type: "response.output_item.done",
        response_id: responseId,
        output_index: index,
        item: {
          id: toolCall.id,
          type: "function_call",
          status: "completed",
          call_id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments
        }
      })
    );
  }

  const completedResponse = {
    id: responseId,
    object: "response",
    created_at: createdAt,
    status: "completed",
    model: requestedModel,
    output: buildCompletedResponseOutput(responseId, accumulatedText, toolCalls),
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0
    }
  };

  if (accumulatedText.length > 0 || toolCalls.length === 0) {
    completionEvents.unshift(
      toSseEvent("response.output_text.done", {
        type: "response.output_text.done",
        response_id: responseId,
        output_index: toolCalls.length,
        content_index: 0,
        text: accumulatedText
      })
    );
  }

  completionEvents.push(
    toSseEvent("response.completed", {
      type: "response.completed",
      response: completedResponse
    })
  );

  return completionEvents.join("");
}

function extractChatChunkDelta(payload: Record<string, unknown>) {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const firstChoice = choices[0];

  if (!firstChoice || typeof firstChoice !== "object") {
    return "";
  }

  const delta = (firstChoice as { delta?: unknown }).delta;

  if (!delta || typeof delta !== "object") {
    return "";
  }

  return asString((delta as { content?: unknown }).content);
}

function extractChatChunkToolCalls(payload: Record<string, unknown>): ChatChunkToolCallDelta[] {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const firstChoice = choices[0];

  if (!firstChoice || typeof firstChoice !== "object") {
    return [];
  }

  const delta = (firstChoice as { delta?: unknown }).delta;

  if (!delta || typeof delta !== "object") {
    return [];
  }

  const toolCalls = (delta as { tool_calls?: unknown }).tool_calls;

  if (!Array.isArray(toolCalls)) {
    return [];
  }

  const normalizedToolCalls: ChatChunkToolCallDelta[] = [];

  for (const toolCall of toolCalls) {
    if (!toolCall || typeof toolCall !== "object") {
      continue;
    }

    const record = toolCall as {
      index?: unknown;
      id?: unknown;
      function?: {
        name?: unknown;
        arguments?: unknown;
      };
    };

    if (typeof record.index !== "number") {
      continue;
    }

    normalizedToolCalls.push({
      index: record.index,
      id: typeof record.id === "string" ? record.id : undefined,
      name: typeof record.function?.name === "string" ? record.function.name : undefined,
      arguments:
        typeof record.function?.arguments === "string"
          ? record.function.arguments
          : ""
    });
  }

  return normalizedToolCalls;
}

function hasFinishReason(payload: Record<string, unknown>) {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const firstChoice = choices[0];

  if (!firstChoice || typeof firstChoice !== "object") {
    return false;
  }

  const finishReason = (firstChoice as { finish_reason?: unknown }).finish_reason;
  return typeof finishReason === "string" && finishReason.length > 0;
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function toSseEvent(event: string, payload: Record<string, unknown>) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function toResponseId(chatId: string) {
  return chatId.replace(/^chatcmpl/, "resp");
}

function toMessageId(responseId: string) {
  return responseId.replace(/^resp/, "msg");
}

function buildCompletedResponseOutput(
  responseId: string,
  accumulatedText: string,
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: string;
  }>
) {
  const output: ResponsesResponse["output"] = toolCalls.map((toolCall) => ({
    id: toolCall.id,
    type: "function_call",
    status: "completed",
    call_id: toolCall.id,
    name: toolCall.name,
    arguments: toolCall.arguments
  }));

  if (accumulatedText.length > 0 || output.length === 0) {
    output.push({
      id: toMessageId(responseId),
      type: "message",
      status: "completed",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: accumulatedText,
          annotations: []
        }
      ]
    });
  }

  return output;
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}
