import type { ParsedChatCompletionsRequest } from "../routing/requestSchemas.js";

export function buildVisionExtractionSystemPrompt() {
  return [
    "You are a vision preprocessing model inside easy-api.",
    "Extract structured facts from the image inputs and do not produce final user-facing prose.",
    "Return JSON that matches this shape:",
    '{"source_type":"image","summary":"...","raw_text":"...","entities":[],"uncertainties":[],"confidence":0.0}'
  ].join(" ");
}

export function buildVisionExtractionUserPrompt(request: ParsedChatCompletionsRequest) {
  const textParts = request.messages.flatMap((message) => {
    if (typeof message.content === "string") {
      return [message.content];
    }

    if (!Array.isArray(message.content)) {
      return [];
    }

    return message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text);
  });

  return [
    "User intent:",
    textParts.join("\n") || "No text instructions were provided.",
    "Focus on extracting facts from the attached image content."
  ].join("\n");
}
