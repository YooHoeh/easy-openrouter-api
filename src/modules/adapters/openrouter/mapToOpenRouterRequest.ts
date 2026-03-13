import type { ParsedChatCompletionsRequest } from "../../routing/requestSchemas.js";
import {
  buildStrictOutputControlMessage,
  getStrictOutputDirective
} from "../../routing/strictOutput.js";

export function mapToOpenRouterRequest(
  request: ParsedChatCompletionsRequest,
  selectedModel: string
) {
  const strictOutputDirective = getStrictOutputDirective(request);

  return {
    ...request,
    model: selectedModel,
    ...(strictOutputDirective
      ? {
          messages: prependStrictOutputControlMessage(request.messages, strictOutputDirective)
        }
      : {}),
    ...(strictOutputDirective && request.temperature === undefined
      ? {
          temperature: 0
        }
      : {})
  };
}

function prependStrictOutputControlMessage(
  messages: ParsedChatCompletionsRequest["messages"],
  directive: NonNullable<ReturnType<typeof getStrictOutputDirective>>
) {
  const controlMessage = buildStrictOutputControlMessage(directive);
  const firstMessage = messages[0];

  if (firstMessage?.role === "developer" && typeof firstMessage.content === "string") {
    return [
      {
        ...firstMessage,
        content: `${controlMessage}\n\n${firstMessage.content}`
      },
      ...messages.slice(1)
    ];
  }

  return [
    {
      role: "developer" as const,
      content: controlMessage
    },
    ...messages
  ];
}
