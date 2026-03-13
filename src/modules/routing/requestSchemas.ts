import { z } from "zod";

const TextContentPartSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().min(1)
  })
  .passthrough();

const ImageContentPartSchema = z
  .object({
    type: z.literal("image_url"),
    image_url: z
      .object({
        url: z.string().min(1),
        detail: z.enum(["auto", "low", "high"]).optional()
      })
      .passthrough()
  })
  .passthrough();

const AudioContentPartSchema = z
  .object({
    type: z.literal("input_audio"),
    input_audio: z
      .object({
        data: z.string().min(1),
        format: z.enum(["wav", "mp3"])
      })
      .passthrough()
  })
  .passthrough();

const ChatMessageSchema = z
  .object({
    role: z.enum(["system", "developer", "user", "assistant", "tool"]),
    content: z.union([
      z.string(),
      z.array(z.union([TextContentPartSchema, ImageContentPartSchema, AudioContentPartSchema])),
      z.null()
    ]),
    name: z.string().min(1).optional(),
    tool_call_id: z.string().min(1).optional(),
    tool_calls: z.array(z.unknown()).optional()
  })
  .passthrough();

const ChatToolSchema = z
  .object({
    type: z.literal("function"),
    function: z
      .object({
        name: z.string().min(1),
        description: z.string().min(1).optional(),
        parameters: z.record(z.string(), z.unknown()).optional()
      })
      .passthrough()
  })
  .passthrough();

const ChatToolChoiceSchema = z.union([
  z.enum(["none", "auto", "required"]),
  z
    .object({
      type: z.literal("function"),
      function: z
        .object({
          name: z.string().min(1)
        })
        .passthrough()
    })
    .passthrough(),
  z
    .object({
      type: z.literal("function"),
      name: z.string().min(1)
    })
    .passthrough()
]);

const MetadataSchema = z.record(z.string(), z.string());
const StopSchema = z.union([
  z.string().min(1),
  z.array(z.string().min(1)).min(1).max(4)
]);

const ResponsesInputTextPartSchema = z
  .object({
    type: z.literal("input_text"),
    text: z.string().min(1)
  })
  .passthrough();

const ResponsesInputImagePartSchema = z
  .object({
    type: z.literal("input_image"),
    image_url: z.union([
      z.string().min(1),
      z
        .object({
          url: z.string().min(1),
          detail: z.enum(["auto", "low", "high"]).optional()
        })
        .passthrough()
    ])
  })
  .passthrough();

const ResponsesCompatibleContentPartSchema = z.union([
  ResponsesInputTextPartSchema,
  ResponsesInputImagePartSchema,
  TextContentPartSchema,
  ImageContentPartSchema,
  AudioContentPartSchema
]);

const ResponsesInputMessageSchema = z
  .object({
    role: z.enum(["system", "developer", "user", "assistant", "tool"]),
    content: z.union([
      z.string(),
      z.array(ResponsesCompatibleContentPartSchema).min(1),
      z.null()
    ]),
    name: z.string().min(1).optional(),
    tool_call_id: z.string().min(1).optional(),
    tool_calls: z.array(z.unknown()).optional()
  })
  .passthrough();

export const ChatCompletionsRequestSchema = z
  .object({
    model: z.string().min(1),
    messages: z.array(ChatMessageSchema).min(1),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    stop: StopSchema.optional(),
    presence_penalty: z.number().min(-2).max(2).optional(),
    frequency_penalty: z.number().min(-2).max(2).optional(),
    seed: z.number().int().optional(),
    max_tokens: z.number().int().positive().optional(),
    stream: z.boolean().optional(),
    tools: z.array(ChatToolSchema).optional(),
    tool_choice: ChatToolChoiceSchema.optional(),
    parallel_tool_calls: z.boolean().optional(),
    metadata: MetadataSchema.optional(),
    response_format: z.object({ type: z.string().min(1) }).passthrough().optional(),
    user: z.string().min(1).optional()
  })
  .passthrough();

export type ParsedChatCompletionsRequest = z.infer<typeof ChatCompletionsRequestSchema>;

export const ResponsesRequestSchema = z
  .object({
    model: z.string().min(1),
    input: z.union([
      z.string().min(1),
      z.array(ResponsesInputMessageSchema).min(1)
    ]),
    instructions: z.string().min(1).optional(),
    stream: z.boolean().optional(),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    stop: StopSchema.optional(),
    presence_penalty: z.number().min(-2).max(2).optional(),
    frequency_penalty: z.number().min(-2).max(2).optional(),
    seed: z.number().int().optional(),
    tools: z.array(ChatToolSchema).optional(),
    tool_choice: ChatToolChoiceSchema.optional(),
    parallel_tool_calls: z.boolean().optional(),
    metadata: MetadataSchema.optional(),
    text: z
      .object({
        format: z.object({ type: z.string().min(1) }).passthrough().optional()
      })
      .passthrough()
      .optional(),
    max_output_tokens: z.number().int().positive().optional(),
    user: z.string().min(1).optional()
  })
  .passthrough();

export type ParsedResponsesRequest = z.infer<typeof ResponsesRequestSchema>;
