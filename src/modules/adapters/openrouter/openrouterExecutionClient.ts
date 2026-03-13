import type { ChatCompletionResponse } from "../../../types/openai.js";
import { rewriteOpenRouterSseStream } from "../../../lib/chatCompletionStreaming.js";
import type { ParsedChatCompletionsRequest } from "../../routing/requestSchemas.js";
import type { DirectRoutePlan } from "../../routing/routingTypes.js";
import { mapFromOpenRouterResponse } from "./mapFromOpenRouterResponse.js";
import { mapToOpenRouterRequest } from "./mapToOpenRouterRequest.js";

interface FetchResponseLike {
  ok: boolean;
  status: number;
  body?: AsyncIterable<Uint8Array | string> | ReadableStream<Uint8Array> | null;
  json(): Promise<unknown>;
  text?(): Promise<string>;
}

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
) => Promise<FetchResponseLike>;

export interface ExecuteChatCompletionParams {
  request: ParsedChatCompletionsRequest;
  routePlan: DirectRoutePlan;
}

export interface ExecutedChatCompletionResult {
  response: ChatCompletionResponse;
  actualModel: string;
  attemptedModels: string[];
  fallbackUsed: boolean;
  runtimeFallbackUsed?: boolean;
}

export interface ExecutedChatCompletionStreamResult {
  stream: AsyncIterable<string>;
  actualModel: string;
  attemptedModels: string[];
  fallbackUsed: boolean;
  runtimeFallbackUsed?: boolean;
}

export interface ChatCompletionsExecutor {
  executeChatCompletion(params: ExecuteChatCompletionParams): Promise<ExecutedChatCompletionResult>;
  executeChatCompletionStream?(
    params: ExecuteChatCompletionParams
  ): Promise<ExecutedChatCompletionStreamResult>;
}

export interface OpenRouterExecutionClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: FetchLike;
}

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

export class OpenRouterExecutionClient implements ChatCompletionsExecutor {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: FetchLike;

  constructor(options: OpenRouterExecutionClientOptions) {
    this.#apiKey = options.apiKey;
    this.#baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.#fetch = options.fetch ?? (globalThis.fetch as FetchLike);
  }

  async executeChatCompletion({
    request,
    routePlan
  }: ExecuteChatCompletionParams): Promise<ExecutedChatCompletionResult> {
    const primaryAttemptModels = [routePlan.selected_model, ...routePlan.fallback_chain];
    const runtimeFallbackModels = routePlan.runtime_fallback
      ? [routePlan.runtime_fallback.selected_model, ...routePlan.runtime_fallback.fallback_chain]
          .filter((modelId) => !primaryAttemptModels.includes(modelId))
      : [];
    const failures: string[] = [];

    for (const [index, modelId] of primaryAttemptModels.entries()) {
      const response = await this.#fetch(`${this.#baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(mapToOpenRouterRequest(request, modelId))
      });

      if (response.ok) {
        return {
          response: mapFromOpenRouterResponse(await response.json(), routePlan),
          actualModel: modelId,
          attemptedModels: primaryAttemptModels.slice(0, index + 1),
          fallbackUsed: modelId !== routePlan.selected_model,
          runtimeFallbackUsed: false
        };
      }

      const errorBody = response.text ? await response.text() : "";
      failures.push(`${modelId}:${response.status}`);

      if (!shouldRetry(response.status, errorBody)) {
        throw new Error(
          `OpenRouter execution failed for ${modelId} with status ${response.status}${
            errorBody ? `: ${errorBody}` : ""
          }`
        );
      }
    }

    for (const [index, modelId] of runtimeFallbackModels.entries()) {
      const response = await this.#fetch(`${this.#baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(mapToOpenRouterRequest(request, modelId))
      });

      if (response.ok) {
        return {
          response: mapFromOpenRouterResponse(await response.json(), routePlan),
          actualModel: modelId,
          attemptedModels: [
            ...primaryAttemptModels,
            ...runtimeFallbackModels.slice(0, index + 1)
          ],
          fallbackUsed: true,
          runtimeFallbackUsed: true
        };
      }

      const errorBody = response.text ? await response.text() : "";
      failures.push(`${modelId}:${response.status}`);

      if (!shouldRetry(response.status, errorBody)) {
        throw new Error(
          `OpenRouter runtime fallback execution failed for ${modelId} with status ${response.status}${
            errorBody ? `: ${errorBody}` : ""
          }`
        );
      }
    }

    throw new Error(
      `OpenRouter execution exhausted the fallback chain without a successful response (${failures.join(", ")})`
    );
  }

  async executeChatCompletionStream({
    request,
    routePlan
  }: ExecuteChatCompletionParams): Promise<ExecutedChatCompletionStreamResult> {
    const primaryAttemptModels = [routePlan.selected_model, ...routePlan.fallback_chain];
    const runtimeFallbackModels = routePlan.runtime_fallback
      ? [routePlan.runtime_fallback.selected_model, ...routePlan.runtime_fallback.fallback_chain]
          .filter((modelId) => !primaryAttemptModels.includes(modelId))
      : [];
    const failures: string[] = [];

    for (const [index, modelId] of primaryAttemptModels.entries()) {
      const response = await this.#fetch(`${this.#baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(mapToOpenRouterRequest({
          ...request,
          stream: true
        }, modelId))
      });

      if (response.ok) {
        if (!response.body) {
          throw new Error(`OpenRouter streaming response for ${modelId} did not include a body.`);
        }

        return {
          stream: rewriteOpenRouterSseStream(response.body, routePlan.requested_model),
          actualModel: modelId,
          attemptedModels: primaryAttemptModels.slice(0, index + 1),
          fallbackUsed: modelId !== routePlan.selected_model,
          runtimeFallbackUsed: false
        };
      }

      const errorBody = response.text ? await response.text() : "";
      failures.push(`${modelId}:${response.status}`);

      if (!shouldRetry(response.status, errorBody)) {
        throw new Error(
          `OpenRouter streaming execution failed for ${modelId} with status ${response.status}${
            errorBody ? `: ${errorBody}` : ""
          }`
        );
      }
    }

    for (const [index, modelId] of runtimeFallbackModels.entries()) {
      const response = await this.#fetch(`${this.#baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(mapToOpenRouterRequest({
          ...request,
          stream: true
        }, modelId))
      });

      if (response.ok) {
        if (!response.body) {
          throw new Error(`OpenRouter streaming response for ${modelId} did not include a body.`);
        }

        return {
          stream: rewriteOpenRouterSseStream(response.body, routePlan.requested_model),
          actualModel: modelId,
          attemptedModels: [
            ...primaryAttemptModels,
            ...runtimeFallbackModels.slice(0, index + 1)
          ],
          fallbackUsed: true,
          runtimeFallbackUsed: true
        };
      }

      const errorBody = response.text ? await response.text() : "";
      failures.push(`${modelId}:${response.status}`);

      if (!shouldRetry(response.status, errorBody)) {
        throw new Error(
          `OpenRouter streaming runtime fallback execution failed for ${modelId} with status ${response.status}${
            errorBody ? `: ${errorBody}` : ""
          }`
        );
      }
    }

    throw new Error(
      `OpenRouter streaming execution exhausted the fallback chain without a successful response (${failures.join(", ")})`
    );
  }
}

function shouldRetry(status: number, errorBody = "") {
  if (status >= 500 || status === 404 || status === 408 || status === 429) {
    return true;
  }

  if (status !== 400) {
    return false;
  }

  const normalizedBody = errorBody.toLowerCase();

  return normalizedBody.includes("provider returned error")
    || normalizedBody.includes("failed_precondition")
    || normalizedBody.includes("user location is not supported")
    || normalizedBody.includes("temporarily unavailable");
}
