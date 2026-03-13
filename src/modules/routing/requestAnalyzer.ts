import type { ParsedChatCompletionsRequest } from "./requestSchemas.js";

export type TaskType =
  | "general_chat"
  | "coding"
  | "reasoning"
  | "vision_qa"
  | "document_extraction"
  | "audio_transcription";

export type RequiredModality = "text" | "image" | "audio";

export type RequiredFeature = "tools" | "response_format" | "streaming";

export interface NormalizedRouteRequest {
  task_type: TaskType;
  required_modalities: RequiredModality[];
  required_features: RequiredFeature[];
  preferred_context_length: number;
  allow_paid_fallback: boolean;
  debug: boolean;
}

const DEFAULT_CONTEXT_LENGTH = 16_000;
const EXTENDED_CONTEXT_LENGTH = 32_000;
type ParsedContentPart = Extract<
  NonNullable<ParsedChatCompletionsRequest["messages"][number]["content"]>,
  unknown[]
>[number];

export function analyzeChatCompletionsRequest(
  request: ParsedChatCompletionsRequest,
  options: { debug?: boolean; allowPaidFallback?: boolean } = {}
): NormalizedRouteRequest {
  const requiredModalities = new Set<RequiredModality>(["text"]);
  const requiredFeatures = new Set<RequiredFeature>();
  const textFragments: string[] = [];

  for (const message of request.messages) {
    if (typeof message.content === "string") {
      textFragments.push(message.content);
      continue;
    }

    if (!Array.isArray(message.content)) {
      continue;
    }

    for (const part of message.content) {
      collectPartDetails(part, requiredModalities, textFragments);
    }
  }

  if ((request.tools?.length ?? 0) > 0) {
    requiredFeatures.add("tools");
  }

  if (request.response_format) {
    requiredFeatures.add("response_format");
  }

  if (request.stream) {
    requiredFeatures.add("streaming");
  }

  const combinedText = textFragments.join("\n").toLowerCase();
  const taskType = inferTaskType(request, combinedText, requiredModalities);

  return {
    task_type: taskType,
    required_modalities: sortByOrder(requiredModalities, ["text", "image", "audio"]),
    required_features: sortByOrder(requiredFeatures, ["tools", "response_format", "streaming"]),
    preferred_context_length: inferPreferredContextLength(
      combinedText.length,
      request.max_tokens,
      requiredModalities,
      requiredFeatures
    ),
    allow_paid_fallback: options.allowPaidFallback ?? false,
    debug: options.debug ?? false
  };
}

function collectPartDetails(
  part: ParsedContentPart,
  requiredModalities: Set<RequiredModality>,
  textFragments: string[]
) {
  if (part.type === "text") {
    textFragments.push(part.text);
    return;
  }

  if (part.type === "image_url") {
    requiredModalities.add("image");
    return;
  }

  requiredModalities.add("audio");
}

function inferTaskType(
  request: ParsedChatCompletionsRequest,
  combinedText: string,
  requiredModalities: Set<RequiredModality>
): TaskType {
  if (requiredModalities.has("audio")) {
    return "audio_transcription";
  }

  if (requiredModalities.has("image")) {
    if (looksLikeDocumentExtraction(combinedText)) {
      return "document_extraction";
    }

    return "vision_qa";
  }

  if (request.model === "auto:coding" || looksLikeCoding(combinedText)) {
    return "coding";
  }

  if (request.model === "auto:reasoning" || request.response_format || looksLikeReasoning(combinedText)) {
    return "reasoning";
  }

  return "general_chat";
}

function inferPreferredContextLength(
  combinedTextLength: number,
  maxTokens: number | undefined,
  requiredModalities: Set<RequiredModality>,
  requiredFeatures: Set<RequiredFeature>
) {
  if (
    requiredModalities.has("image") ||
    requiredModalities.has("audio") ||
    requiredFeatures.has("tools") ||
    requiredFeatures.has("response_format") ||
    combinedTextLength > 12_000 ||
    (maxTokens ?? 0) > 4_000
  ) {
    return EXTENDED_CONTEXT_LENGTH;
  }

  return DEFAULT_CONTEXT_LENGTH;
}

function looksLikeDocumentExtraction(input: string) {
  return /\b(invoice|receipt|form|document|passport|id card|ocr|extract|table|total amount)\b/.test(
    input
  );
}

function looksLikeCoding(input: string) {
  return /\b(code|bug|debug|refactor|typescript|javascript|node|fastify|function|class|sql|test)\b/.test(
    input
  );
}

function looksLikeReasoning(input: string) {
  return /\b(compare|analy[sz]e|reason|trade-off|tradeoff|explain|step by step|why)\b/.test(input);
}

function sortByOrder<T extends string>(values: Set<T>, order: T[]) {
  return order.filter((value) => values.has(value));
}
