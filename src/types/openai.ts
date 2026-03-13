export type ChatMessageRole = "system" | "developer" | "user" | "assistant" | "tool";

export interface TextContentPart {
  type: "text";
  text: string;
}

export interface ImageUrlContentPart {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
}

export interface InputAudioContentPart {
  type: "input_audio";
  input_audio: {
    data: string;
    format: "wav" | "mp3";
  };
}

export type ChatMessageContentPart = TextContentPart | ImageUrlContentPart | InputAudioContentPart;

export interface ChatMessage {
  role: ChatMessageRole;
  content: string | ChatMessageContentPart[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
}

export interface ChatToolFunction {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface ChatTool {
  type: "function";
  function: ChatToolFunction;
}

export interface ChatToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export type ChatToolChoice =
  | "none"
  | "auto"
  | "required"
  | {
      type: "function";
      function: {
        name: string;
        [key: string]: unknown;
      };
      [key: string]: unknown;
    }
  | {
      type: "function";
      name: string;
      [key: string]: unknown;
    };

export interface ChatCompletionsRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  seed?: number;
  max_tokens?: number;
  stream?: boolean;
  tools?: ChatTool[];
  tool_choice?: ChatToolChoice;
  parallel_tool_calls?: boolean;
  metadata?: Record<string, string>;
  response_format?: {
    type: string;
    [key: string]: unknown;
  };
  user?: string;
  [key: string]: unknown;
}

export interface ChatCompletionChoice {
  index: number;
  message: {
    role: "assistant";
    content: string | null;
    tool_calls?: ChatToolCall[];
  };
  finish_reason: "stop" | "length" | "content_filter" | "tool_calls";
}

export interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: ChatCompletionUsage;
  route?: Record<string, unknown>;
}

export interface ResponsesInputTextPart {
  type: "input_text";
  text: string;
}

export interface ResponsesInputImagePart {
  type: "input_image";
  image_url:
    | string
    | {
        url: string;
        detail?: "auto" | "low" | "high";
      };
}

export type ResponsesInputContentPart = ResponsesInputTextPart | ResponsesInputImagePart;

export interface ResponsesInputMessage {
  role: ChatMessageRole;
  content: string | ChatMessageContentPart[] | ResponsesInputContentPart[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
}

export interface ResponsesRequest {
  model: string;
  input: string | ResponsesInputMessage[];
  instructions?: string;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  seed?: number;
  tools?: ChatTool[];
  tool_choice?: ChatToolChoice;
  parallel_tool_calls?: boolean;
  metadata?: Record<string, string>;
  text?: {
    format?: {
      type: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  max_output_tokens?: number;
  user?: string;
  [key: string]: unknown;
}

export interface ResponseOutputText {
  type: "output_text";
  text: string;
  annotations: unknown[];
}

export interface ResponseOutputMessage {
  id: string;
  type: "message";
  status: "completed";
  role: "assistant";
  content: ResponseOutputText[];
}

export interface ResponseOutputFunctionCall {
  id: string;
  type: "function_call";
  status: "completed";
  call_id: string;
  name: string;
  arguments: string;
}

export interface ResponseUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface ResponsesResponse {
  id: string;
  object: "response";
  created_at: number;
  status: "completed";
  model: string;
  output: Array<ResponseOutputMessage | ResponseOutputFunctionCall>;
  usage: ResponseUsage;
  route?: Record<string, unknown>;
}

export interface OpenAIErrorResponse {
  error: {
    message: string;
    type: "invalid_request_error" | "api_error";
    code: string;
    param?: string | null;
  };
}

export interface OpenAIModel {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}

export interface ModelListResponse {
  object: "list";
  data: OpenAIModel[];
}
