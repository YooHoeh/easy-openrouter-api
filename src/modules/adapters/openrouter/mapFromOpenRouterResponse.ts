import { z } from "zod";

import type { ChatCompletionResponse } from "../../../types/openai.js";
import type { DirectRoutePlan } from "../../routing/routingTypes.js";

const OpenRouterChatCompletionSchema = z
  .object({
    id: z.string(),
    object: z.string().optional(),
    created: z.number().optional(),
    model: z.string().optional(),
    choices: z.array(
      z
        .object({
          index: z.number().int(),
          message: z
            .object({
              role: z.string(),
              content: z.string().nullable().optional(),
              tool_calls: z
                .array(
                  z
                    .object({
                      id: z.string().min(1).optional(),
                      type: z.string().optional(),
                      function: z
                        .object({
                          name: z.string().min(1).optional(),
                          arguments: z.string().optional()
                        })
                        .passthrough()
                        .optional()
                    })
                    .passthrough()
                )
                .optional()
            })
            .passthrough(),
          finish_reason: z.enum(["stop", "length", "content_filter", "tool_calls"]).nullable().optional()
        })
        .passthrough()
    ),
    usage: z
      .object({
        prompt_tokens: z.number().int().nonnegative(),
        completion_tokens: z.number().int().nonnegative(),
        total_tokens: z.number().int().nonnegative()
      })
      .optional()
  })
  .passthrough();

export function mapFromOpenRouterResponse(
  payload: unknown,
  routePlan: DirectRoutePlan
): ChatCompletionResponse {
  const parsed = OpenRouterChatCompletionSchema.parse(payload);

  return {
    id: parsed.id,
    object: "chat.completion",
    created: parsed.created ?? Math.floor(Date.now() / 1000),
    model: routePlan.requested_model,
    choices: parsed.choices.map((choice) => ({
      index: choice.index,
      message: {
        role: "assistant",
        content: choice.message.content ?? null,
        ...(choice.message.tool_calls
          ? {
              tool_calls: choice.message.tool_calls.map((toolCall, index) => ({
                ...toolCall,
                id: toolCall.id ?? `call_${choice.index}_${index}`,
                type: "function" as const,
                function: {
                  ...(toolCall.function ?? {}),
                  name: toolCall.function?.name ?? "unknown_function",
                  arguments: toolCall.function?.arguments ?? "{}"
                }
              }))
            }
          : {})
      },
      finish_reason: choice.finish_reason ?? "stop"
    })),
    usage: parsed.usage ?? {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    }
  };
}
