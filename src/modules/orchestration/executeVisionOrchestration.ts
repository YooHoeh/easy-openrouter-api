import { createChatCompletionSseStream } from "../../lib/chatCompletionStreaming.js";
import { capabilityUnavailableError } from "../../lib/errors.js";
import type { ChatCompletionResponse } from "../../types/openai.js";
import type {
  ChatCompletionsExecutor,
  ExecutedChatCompletionResult,
  ExecutedChatCompletionStreamResult
} from "../adapters/openrouter/openrouterExecutionClient.js";
import type { CatalogModel } from "../catalog/catalogTypes.js";
import { buildRoutePlan } from "../routing/buildRoutePlan.js";
import { resolveModelAlias } from "../routing/modelAliases.js";
import type { NormalizedRouteRequest } from "../routing/requestAnalyzer.js";
import type { ParsedChatCompletionsRequest } from "../routing/requestSchemas.js";
import type { DirectRoutePlan } from "../routing/routingTypes.js";
import type {
  VisionIntermediateResult,
  VisionOrchestrationPlan
} from "./intermediateContracts.js";
import {
  buildVisionReasoningRouteRequest,
  orchestrateVisionRequest
} from "./orchestrateVisionRequest.js";

type ParsedMessage = ParsedChatCompletionsRequest["messages"][number];
type ParsedContentPart = Extract<NonNullable<ParsedMessage["content"]>, unknown[]>[number];

interface PreparedVisionOrchestrationError {
  code: "capability_unavailable";
  message: string;
  reasons: string[];
}

export interface PreparedVisionOrchestration {
  requestedModel: string;
  normalizedRequest: NormalizedRouteRequest;
  reasoningPlan: DirectRoutePlan;
  preprocessorPlan: DirectRoutePlan;
  plan: VisionOrchestrationPlan;
}

export type PrepareVisionOrchestrationResult =
  | {
      ok: true;
      prepared: PreparedVisionOrchestration;
    }
  | {
      ok: false;
      error: PreparedVisionOrchestrationError;
    };

export interface VisionPreprocessorExecutionMetadata {
  type: "vision";
  selectedModel: string;
  actualModel: string;
  attemptedModels: string[];
  fallbackUsed: boolean;
  runtimeFallbackUsed: boolean;
  outputContract: "vision_intermediate_v1";
}

interface VisionExecutionBase {
  prepared: PreparedVisionOrchestration;
  selectedPreprocessors: string[];
  preprocessorExecutions: [VisionPreprocessorExecutionMetadata];
  actualModel: string;
  attemptedModels: string[];
  fallbackUsed: boolean;
  reasoningAttemptedModels: string[];
  reasoningFallbackUsed: boolean;
  reasoningRuntimeFallbackUsed: boolean;
}

export interface ExecutedVisionOrchestrationResult extends VisionExecutionBase {
  response: ChatCompletionResponse;
}

export interface ExecutedVisionOrchestrationStreamResult extends VisionExecutionBase {
  stream: AsyncIterable<string>;
}

export function prepareVisionOrchestration(input: {
  request: ParsedChatCompletionsRequest;
  routeRequest: NormalizedRouteRequest;
  models: CatalogModel[];
  enableExplicitModelRuntimeFallback: boolean;
}): PrepareVisionOrchestrationResult {
  const reasoningRequest = buildVisionReasoningRouteRequest(input.request.model, input.routeRequest);
  const reasoningPlanResult = buildRoutePlan(input.models, reasoningRequest, input.request.model, {
    enableExplicitModelRuntimeFallback: input.enableExplicitModelRuntimeFallback
  });

  if (!reasoningPlanResult.ok) {
    return {
      ok: false,
      error: {
        code: "capability_unavailable",
        message: "No eligible reasoning model is available for vision orchestration.",
        reasons: reasoningPlanResult.error.reasons
      }
    };
  }

  const orchestrationResult = orchestrateVisionRequest({
    request: input.request,
    routeRequest: input.routeRequest,
    reasoningPlan: reasoningPlanResult.plan,
    models: input.models
  });

  if (!orchestrationResult.ok) {
    return {
      ok: false,
      error: orchestrationResult.error
    };
  }

  const preprocessor = orchestrationResult.plan.preprocessors[0];
  const preprocessorRouteRequest: NormalizedRouteRequest = {
    task_type: "vision_qa",
    required_modalities: ["text", "image"],
    required_features: [],
    preferred_context_length: Math.max(input.routeRequest.preferred_context_length, 32000),
    allow_paid_fallback: input.routeRequest.allow_paid_fallback,
    debug: input.routeRequest.debug
  };

  return {
    ok: true,
    prepared: {
      requestedModel: input.request.model,
      normalizedRequest: input.routeRequest,
      reasoningPlan: reasoningPlanResult.plan,
      preprocessorPlan: {
        mode: "direct",
        requested_model: "auto:vision",
        resolved_model: resolveModelAlias("auto:vision", preprocessorRouteRequest),
        normalized_request: preprocessorRouteRequest,
        selected_model: preprocessor.model,
        fallback_chain: preprocessor.fallback_chain,
        reasons: ["selected the highest-scoring eligible candidate for vision preprocessing"],
        ranked_candidates: []
      },
      plan: orchestrationResult.plan
    }
  };
}

export async function executeVisionOrchestration(input: {
  request: ParsedChatCompletionsRequest;
  prepared: PreparedVisionOrchestration;
  executionClient: ChatCompletionsExecutor;
}): Promise<ExecutedVisionOrchestrationResult> {
  const preprocessorRequest = buildVisionPreprocessorRequest(input.request, input.prepared);
  const preprocessorExecution = await input.executionClient.executeChatCompletion({
    request: preprocessorRequest,
    routePlan: input.prepared.preprocessorPlan
  });
  const intermediate = coerceVisionIntermediateResult(extractPrimaryResponseContent(preprocessorExecution.response));
  const reasoningRequest = buildFinalReasoningRequest(input.request, intermediate);
  const reasoningExecution = await input.executionClient.executeChatCompletion({
    request: reasoningRequest,
    routePlan: input.prepared.reasoningPlan
  });

  return mergeExecutionResults(input.prepared, preprocessorExecution, reasoningExecution);
}

export async function executeVisionOrchestrationStream(input: {
  request: ParsedChatCompletionsRequest;
  prepared: PreparedVisionOrchestration;
  executionClient: ChatCompletionsExecutor;
}): Promise<ExecutedVisionOrchestrationStreamResult> {
  const preprocessorRequest = buildVisionPreprocessorRequest(input.request, input.prepared);
  const preprocessorExecution = await input.executionClient.executeChatCompletion({
    request: preprocessorRequest,
    routePlan: input.prepared.preprocessorPlan
  });
  const intermediate = coerceVisionIntermediateResult(extractPrimaryResponseContent(preprocessorExecution.response));
  const reasoningRequest = buildFinalReasoningRequest({
    ...input.request,
    stream: true
  }, intermediate);
  const reasoningExecution = input.executionClient.executeChatCompletionStream
    ? await input.executionClient.executeChatCompletionStream({
        request: reasoningRequest,
        routePlan: input.prepared.reasoningPlan
      })
    : await buildSyntheticStreamingExecution(input.executionClient, {
        request: reasoningRequest,
        routePlan: input.prepared.reasoningPlan
      });

  return {
    prepared: input.prepared,
    selectedPreprocessors: input.prepared.plan.preprocessors.map((preprocessor) => preprocessor.model),
    preprocessorExecutions: [buildVisionPreprocessorExecutionMetadata(input.prepared, preprocessorExecution)],
    actualModel: reasoningExecution.actualModel,
    attemptedModels: [
      ...preprocessorExecution.attemptedModels,
      ...reasoningExecution.attemptedModels
    ],
    fallbackUsed: preprocessorExecution.fallbackUsed || reasoningExecution.fallbackUsed,
    reasoningAttemptedModels: reasoningExecution.attemptedModels,
    reasoningFallbackUsed: reasoningExecution.fallbackUsed,
    reasoningRuntimeFallbackUsed: reasoningExecution.runtimeFallbackUsed ?? false,
    stream: reasoningExecution.stream
  };
}

async function buildSyntheticStreamingExecution(
  executor: ChatCompletionsExecutor,
  params: Parameters<ChatCompletionsExecutor["executeChatCompletion"]>[0]
): Promise<ExecutedChatCompletionStreamResult> {
  const execution = await executor.executeChatCompletion(params);

  return {
    actualModel: execution.actualModel,
    attemptedModels: execution.attemptedModels,
    fallbackUsed: execution.fallbackUsed,
    runtimeFallbackUsed: execution.runtimeFallbackUsed ?? false,
    stream: createChatCompletionSseStream(execution.response)
  };
}

function mergeExecutionResults(
  prepared: PreparedVisionOrchestration,
  preprocessorExecution: ExecutedChatCompletionResult,
  reasoningExecution: ExecutedChatCompletionResult
): ExecutedVisionOrchestrationResult {
  return {
    prepared,
    selectedPreprocessors: prepared.plan.preprocessors.map((preprocessor) => preprocessor.model),
    preprocessorExecutions: [buildVisionPreprocessorExecutionMetadata(prepared, preprocessorExecution)],
    actualModel: reasoningExecution.actualModel,
    attemptedModels: [
      ...preprocessorExecution.attemptedModels,
      ...reasoningExecution.attemptedModels
    ],
    fallbackUsed: preprocessorExecution.fallbackUsed || reasoningExecution.fallbackUsed,
    reasoningAttemptedModels: reasoningExecution.attemptedModels,
    reasoningFallbackUsed: reasoningExecution.fallbackUsed,
    reasoningRuntimeFallbackUsed: reasoningExecution.runtimeFallbackUsed ?? false,
    response: reasoningExecution.response
  };
}

function buildVisionPreprocessorExecutionMetadata(
  prepared: PreparedVisionOrchestration,
  execution: ExecutedChatCompletionResult
): VisionPreprocessorExecutionMetadata {
  return {
    type: "vision",
    selectedModel: prepared.preprocessorPlan.selected_model,
    actualModel: execution.actualModel,
    attemptedModels: execution.attemptedModels,
    fallbackUsed: execution.fallbackUsed,
    runtimeFallbackUsed: execution.runtimeFallbackUsed ?? false,
    outputContract: "vision_intermediate_v1"
  };
}

function buildVisionPreprocessorRequest(
  request: ParsedChatCompletionsRequest,
  prepared: PreparedVisionOrchestration
): ParsedChatCompletionsRequest {
  const preprocessor = prepared.plan.preprocessors[0];
  const imageParts = extractImageParts(request.messages);

  if (imageParts.length === 0) {
    throw capabilityUnavailableError("No image input was available for vision preprocessing.");
  }

  return {
    model: "auto:vision",
    temperature: 0,
    user: request.user,
    messages: [
      {
        role: "system",
        content: preprocessor.prompt.system
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: preprocessor.prompt.user
          },
          ...imageParts
        ]
      }
    ]
  };
}

function buildFinalReasoningRequest(
  request: ParsedChatCompletionsRequest,
  intermediate: VisionIntermediateResult
): ParsedChatCompletionsRequest {
  return {
    ...request,
    messages: [
      ...request.messages.map(stripImageContentFromMessage),
      {
        role: "developer",
        content: [
          "The image inputs were preprocessed upstream.",
          "Use the following structured vision result as the source of truth for any referenced image content.",
          JSON.stringify(intermediate)
        ].join("\n")
      }
    ]
  };
}

function stripImageContentFromMessage(message: ParsedMessage): ParsedMessage {
  if (!Array.isArray(message.content)) {
    return message;
  }

  const remainingTextParts = message.content.filter(
    (part): part is Extract<ParsedContentPart, { type: "text" }> => part.type === "text"
  );

  if (remainingTextParts.length === 0) {
    return {
      ...message,
      content: "[Image inputs were preprocessed separately.]"
    };
  }

  return {
    ...message,
    content: remainingTextParts
  };
}

function extractImageParts(messages: ParsedMessage[]) {
  return messages.flatMap((message) => {
    if (!Array.isArray(message.content)) {
      return [];
    }

    return message.content.filter(
      (part): part is Extract<ParsedContentPart, { type: "image_url" }> => part.type === "image_url"
    );
  });
}

function extractPrimaryResponseContent(response: ChatCompletionResponse) {
  return response.choices[0]?.message.content ?? "";
}

function coerceVisionIntermediateResult(content: string): VisionIntermediateResult {
  const parsed = tryParseVisionIntermediate(content);

  if (!parsed) {
    return {
      source_type: "image",
      summary: content.slice(0, 280) || "No structured image summary was returned.",
      raw_text: content,
      entities: [],
      uncertainties: [],
      confidence: 0.35
    };
  }

  return {
    source_type: "image",
    summary: asString(parsed.summary, content.slice(0, 280) || "No structured image summary was returned."),
    raw_text: asString(parsed.raw_text, content),
    entities: Array.isArray(parsed.entities)
      ? parsed.entities.flatMap((entry) => mapVisionEntity(entry))
      : [],
    uncertainties: Array.isArray(parsed.uncertainties)
      ? parsed.uncertainties.flatMap((entry) => mapVisionUncertainty(entry))
      : [],
    confidence: clampConfidence(parsed.confidence)
  };
}

function tryParseVisionIntermediate(content: string) {
  const directCandidate = safeJsonParse(content);

  if (directCandidate && typeof directCandidate === "object") {
    return directCandidate as Record<string, unknown>;
  }

  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");

  if (start === -1 || end <= start) {
    return null;
  }

  const fragmentCandidate = safeJsonParse(content.slice(start, end + 1));
  return fragmentCandidate && typeof fragmentCandidate === "object"
    ? (fragmentCandidate as Record<string, unknown>)
    : null;
}

function safeJsonParse(content: string) {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return null;
  }
}

function mapVisionEntity(entry: unknown) {
  if (!entry || typeof entry !== "object") {
    return [];
  }

  const candidate = entry as Record<string, unknown>;
  const type = asString(candidate.type);
  const value = asString(candidate.value);

  if (!type || !value) {
    return [];
  }

  return [
    {
      type,
      value,
      ...(typeof candidate.confidence === "number"
        ? {
            confidence: clampConfidence(candidate.confidence)
          }
        : {})
    }
  ];
}

function mapVisionUncertainty(entry: unknown) {
  if (!entry || typeof entry !== "object") {
    return [];
  }

  const candidate = entry as Record<string, unknown>;
  const field = asString(candidate.field);
  const reason = asString(candidate.reason);

  if (!field || !reason) {
    return [];
  }

  return [
    {
      field,
      reason
    }
  ];
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function clampConfidence(value: unknown) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0.5;
  }

  return Math.max(0, Math.min(1, value));
}
