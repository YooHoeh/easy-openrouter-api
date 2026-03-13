import { z } from "zod";

const OpenRouterPricingSchema = z
  .object({
    prompt: z.string(),
    completion: z.string(),
    request: z.string().optional(),
    image: z.string().optional()
  })
  .passthrough();

const OpenRouterArchitectureSchema = z
  .object({
    input_modalities: z.array(z.string()).optional(),
    output_modalities: z.array(z.string()).optional(),
    tokenizer: z.string().optional(),
    instruct_type: z.string().nullable().optional()
  })
  .passthrough();

const OpenRouterTopProviderSchema = z
  .object({
    context_length: z.number().int().positive().nullable().optional(),
    max_completion_tokens: z.number().int().positive().nullable().optional(),
    is_moderated: z.boolean().nullable().optional()
  })
  .passthrough();

export const OpenRouterModelSchema = z
  .object({
    id: z.string().min(1),
    canonical_slug: z.string().min(1).optional(),
    name: z.string().min(1),
    created: z.number().nullable().optional(),
    description: z.string().nullable().optional(),
    context_length: z.number().int().positive().nullable().optional(),
    architecture: OpenRouterArchitectureSchema.optional(),
    pricing: OpenRouterPricingSchema,
    top_provider: OpenRouterTopProviderSchema.optional(),
    supported_parameters: z.array(z.string()).optional()
  })
  .passthrough();

const OpenRouterModelsResponseSchema = z
  .object({
    data: z.array(OpenRouterModelSchema)
  })
  .passthrough();

export type OpenRouterModel = z.infer<typeof OpenRouterModelSchema>;

interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text?(): Promise<string>;
}

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
  }
) => Promise<FetchResponseLike>;

export interface OpenRouterClientOptions {
  baseUrl?: string;
  apiKey?: string;
  fetch?: FetchLike;
}

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

export class OpenRouterClient {
  readonly #baseUrl: string;
  readonly #apiKey: string | undefined;
  readonly #fetch: FetchLike;

  constructor(options: OpenRouterClientOptions = {}) {
    this.#baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? (globalThis.fetch as FetchLike);
  }

  async fetchModels(): Promise<OpenRouterModel[]> {
    const response = await this.#fetch(`${this.#baseUrl}/models`, {
      method: "GET",
      headers: this.buildHeaders()
    });

    if (!response.ok) {
      const errorBody = response.text ? await response.text() : "";
      throw new Error(
        `OpenRouter models request failed with status ${response.status}${errorBody ? `: ${errorBody}` : ""}`
      );
    }

    const payload = OpenRouterModelsResponseSchema.parse(await response.json());
    return payload.data;
  }

  buildHeaders(): Record<string, string> {
    if (!this.#apiKey) {
      return {};
    }

    return {
      Authorization: `Bearer ${this.#apiKey}`
    };
  }
}
