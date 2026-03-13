import type { ChatCompletionResponse } from "../../types/openai.js";
import type { ParsedChatCompletionsRequest } from "./requestSchemas.js";

const STRICT_OUTPUT_CONTROL_MESSAGE =
  "Strict output mode: if the user asks for an exact reply or says to only reply/output specific text, return exactly that text and nothing else.";
const STRICT_OUTPUT_PATTERN =
  /\b(?:only|just)\s+(?:reply|respond|answer|output)\b|\b(?:reply|respond|output)\s+exactly\b|\boutput exactly\b|\bnothing else\b|\bno explanation\b|\bwithout explanation\b|\bverbatim\b|\u53ea(?:\u56de\u590d|\u56de\u7b54|\u8f93\u51fa)|\u4ec5(?:\u56de\u590d|\u8f93\u51fa)|\u4e0d\u8981(?:\u89e3\u91ca|\u8bf4\u660e|\u5176\u4ed6|\u989d\u5916)|\u539f\u6837\u8f93\u51fa|\u4e00\u5b57\u4e0d\u5dee/i;
const EXACT_REPLY_PATTERNS = [
  /\b(?:only|just)\s+(?:reply|respond|answer|output)(?:\s+with)?\s*[:\-]?\s*["'`]?([^"'`\n.,!?;:]+(?: [^"'`\n.,!?;:]+)*)["'`]?/i,
  /\u53ea(?:\u56de\u590d|\u56de\u7b54|\u8f93\u51fa)\s*[:\uff1a]?\s*["'`]?([^\n\uff0c\u3002\uff1f\uff01,.;；]+)/i,
  /\u4ec5(?:\u56de\u590d|\u8f93\u51fa)\s*[:\uff1a]?\s*["'`]?([^\n\uff0c\u3002\uff1f\uff01,.;；]+)/i
] as const;
const PURE_EXACT_REPLY_CLEANUP_PATTERNS = [
  /\bplease\b/gi,
  /\u8bf7/g,
  /\bnothing else\b/gi,
  /\bno explanation\b/gi,
  /\bwithout explanation\b/gi,
  /\u4e0d\u8981\u8f93\u51fa\u5176\u4ed6\u5185\u5bb9/g,
  /\u4e0d\u8981\u5176\u4ed6\u5185\u5bb9/g,
  /\u4e0d\u8981\u89e3\u91ca/g,
  /\u4e0d\u8981\u8bf4\u660e/g,
  /["'`]/g,
  /[.,!?;:\-\u3002\uff0c\uff1f\uff01\uff1b\uff1a]/g,
  /\s+/g
] as const;

export interface StrictOutputDirective {
  exact_reply_text: string | null;
  pure_exact_reply_instruction: boolean;
}

export function getStrictOutputDirective(
  request: ParsedChatCompletionsRequest
): StrictOutputDirective | null {
  const content = collectMessageText(request).trim();

  if (content.length === 0 || !STRICT_OUTPUT_PATTERN.test(content)) {
    return null;
  }

  const exactReplyText = extractExactReplyText(content);

  return {
    exact_reply_text: exactReplyText,
    pure_exact_reply_instruction: isPureExactReplyInstruction(content)
  };
}

export function buildStrictOutputControlMessage(directive: StrictOutputDirective) {
  if (!directive.exact_reply_text) {
    return STRICT_OUTPUT_CONTROL_MESSAGE;
  }

  return `${STRICT_OUTPUT_CONTROL_MESSAGE} Exact reply: ${directive.exact_reply_text}`;
}

export function buildStrictOutputShortcutResponse(
  request: ParsedChatCompletionsRequest
): {
  response: ChatCompletionResponse;
  route: Record<string, unknown>;
} | null {
  const directive = getStrictOutputDirective(request);

  if (!directive?.pure_exact_reply_instruction || !directive.exact_reply_text) {
    return null;
  }

  const created = Math.floor(Date.now() / 1000);
  const response: ChatCompletionResponse = {
    id: `chatcmpl_shortcut_${Date.now()}`,
    object: "chat.completion",
    created,
    model: request.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: directive.exact_reply_text
        },
        finish_reason: "stop"
      }
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    }
  };

  return {
    response,
    route: {
      mode: "shortcut",
      reason: "pure_exact_reply_instruction",
      exact_reply_text: directive.exact_reply_text
    }
  };
}

function collectMessageText(request: ParsedChatCompletionsRequest) {
  const fragments: string[] = [];

  for (const message of request.messages) {
    if (typeof message.content === "string") {
      fragments.push(message.content);
      continue;
    }

    if (!Array.isArray(message.content)) {
      continue;
    }

    for (const part of message.content) {
      if (part.type === "text") {
        fragments.push(part.text);
      }
    }
  }

  return fragments.join("\n");
}

function extractExactReplyText(content: string) {
  for (const pattern of EXACT_REPLY_PATTERNS) {
    const match = content.match(pattern);
    const candidate = match?.[1]?.trim();

    if (candidate && candidate.length > 0 && candidate.length <= 120) {
      return candidate;
    }
  }

  return null;
}

function isPureExactReplyInstruction(content: string) {
  let remaining = content;

  for (const pattern of EXACT_REPLY_PATTERNS) {
    remaining = remaining.replace(pattern, " ");
  }

  for (const pattern of PURE_EXACT_REPLY_CLEANUP_PATTERNS) {
    remaining = remaining.replace(pattern, "");
  }

  return remaining.trim().length === 0;
}
