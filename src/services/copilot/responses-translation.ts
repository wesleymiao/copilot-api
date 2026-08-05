import { createHash } from "node:crypto"

import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
  ChatCompletionsPayload,
  ContentPart,
  Message,
} from "./create-chat-completions"
import type {
  ResponseFunctionCall,
  ResponseInputContent,
  ResponseInputItem,
  ResponseOutputMessage,
  ResponseOutputContent,
  ResponsesPayload,
  ResponsesResponse,
  ResponsesStreamEvent,
  ResponsesStreamState,
} from "./responses-types"

export function isResponsesApiModel(model: string): boolean {
  return /^gpt-5(?:[.-]|$)/.test(model)
}

export function translateChatCompletionsToResponses(
  payload: ChatCompletionsPayload,
): ResponsesPayload {
  const instructions = payload.messages
    .filter(
      (message) => message.role === "system" || message.role === "developer",
    )
    .map((message) => contentToText(message.content))
    .filter(Boolean)
    .join("\n\n")

  return {
    model: payload.model,
    input: payload.messages
      .filter(
        (message) => message.role !== "system" && message.role !== "developer",
      )
      .flatMap((message) => translateMessage(message)),
    ...(instructions && { instructions }),
    max_output_tokens: payload.max_tokens,
    stream: payload.stream,
    temperature: payload.temperature,
    top_p: payload.top_p,
    tools: payload.tools?.map((tool) => ({
      type: "function",
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    })),
    tool_choice: translateToolChoice(payload.tool_choice),
    user: normalizeUser(payload.user),
    store: false,
  }
}

function normalizeUser(user: string | null | undefined): string | undefined {
  if (!user) {
    return undefined
  }
  if (user.length <= 64) {
    return user
  }
  return createHash("sha256").update(user).digest("hex")
}

function translateMessage(message: Message): Array<ResponseInputItem> {
  switch (message.role) {
    case "user": {
      const content = translateUserContent(message.content)
      return content.length > 0 ? [{ role: "user", content }] : []
    }
    case "assistant": {
      const items: Array<ResponseInputItem> = []
      const text = contentToText(message.content)
      if (text) {
        items.push({
          role: "assistant",
          content: [{ type: "output_text", text }],
        })
      }
      for (const toolCall of message.tool_calls ?? []) {
        items.push({
          type: "function_call",
          call_id: toolCall.id,
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
        })
      }
      return items
    }
    case "tool": {
      if (!message.tool_call_id) {
        throw new Error("Tool message is missing tool_call_id")
      }
      return [
        {
          type: "function_call_output",
          call_id: message.tool_call_id,
          output: contentToText(message.content),
        },
      ]
    }
    default: {
      return []
    }
  }
}

function translateUserContent(
  content: Message["content"],
): Array<ResponseInputContent> {
  if (typeof content === "string") {
    return [{ type: "input_text", text: content }]
  }
  if (!content) {
    return []
  }
  return content.map((part) =>
    part.type === "text" ?
      { type: "input_text", text: part.text }
    : { type: "input_image", image_url: part.image_url.url },
  )
}

function contentToText(content: Message["content"]): string {
  if (typeof content === "string") {
    return content
  }
  if (!content) {
    return ""
  }
  return content
    .filter(
      (part): part is Extract<ContentPart, { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("\n\n")
}

function translateToolChoice(
  toolChoice: ChatCompletionsPayload["tool_choice"],
): ResponsesPayload["tool_choice"] {
  if (!toolChoice || typeof toolChoice === "string") {
    return toolChoice ?? undefined
  }
  return {
    type: "function",
    name: toolChoice.function.name,
  }
}

export function translateResponsesToChatCompletion(
  response: ResponsesResponse,
): ChatCompletionResponse {
  const text = response.output
    .filter((item): item is ResponseOutputMessage => item.type === "message")
    .flatMap((item) => item.content)
    .map((content) => responseContentToText(content))
    .join("")

  const functionCalls = response.output.filter(
    (item): item is ResponseFunctionCall => item.type === "function_call",
  )

  return {
    id: response.id,
    object: "chat.completion",
    created: response.created_at,
    model: response.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text || null,
          ...(functionCalls.length > 0 && {
            tool_calls: functionCalls.map((call) => ({
              id: call.call_id,
              type: "function",
              function: {
                name: call.name,
                arguments: call.arguments,
              },
            })),
          }),
        },
        logprobs: null,
        finish_reason: finishReason(response),
      },
    ],
    usage:
      response.usage ?
        {
          prompt_tokens: response.usage.input_tokens,
          completion_tokens: response.usage.output_tokens,
          total_tokens: response.usage.total_tokens,
          prompt_tokens_details: {
            cached_tokens:
              response.usage.input_tokens_details?.cached_tokens ?? 0,
          },
        }
      : undefined,
  }
}

function responseContentToText(content: ResponseOutputContent): string {
  return content.type === "output_text" ? content.text : content.refusal
}

function finishReason(
  response: ResponsesResponse,
): "stop" | "length" | "tool_calls" | "content_filter" {
  if (response.output.some((item) => item.type === "function_call")) {
    return "tool_calls"
  }
  if (response.status === "incomplete") {
    return "length"
  }
  return "stop"
}

export function createResponsesStreamState(): ResponsesStreamState {
  return {
    id: "",
    model: "",
    created: Math.floor(Date.now() / 1000),
    toolIndexes: new Map(),
    nextToolIndex: 0,
  }
}

export function translateResponsesEventToChatChunks(
  event: ResponsesStreamEvent,
  state: ResponsesStreamState,
): Array<ChatCompletionChunk> {
  switch (event.type) {
    case "response.created": {
      return translateCreatedEvent(event, state)
    }
    case "response.output_text.delta": {
      return translateTextDeltaEvent(event, state)
    }
    case "response.output_item.added": {
      return translateOutputItemAddedEvent(event, state)
    }
    case "response.function_call_arguments.delta": {
      return translateFunctionArgumentsDeltaEvent(event, state)
    }
    case "response.completed":
    case "response.incomplete": {
      return translateFinishedEvent(event, state)
    }
    case "response.failed": {
      throw new Error(
        event.response?.error?.message
          ?? event.error?.message
          ?? "Responses API request failed",
      )
    }
    default: {
      return []
    }
  }
}

function translateCreatedEvent(
  event: ResponsesStreamEvent,
  state: ResponsesStreamState,
): Array<ChatCompletionChunk> {
  if (!event.response) return []
  updateStateFromResponse(event.response, state)
  return [createChunk(state, { role: "assistant" }, null)]
}

function translateTextDeltaEvent(
  event: ResponsesStreamEvent,
  state: ResponsesStreamState,
): Array<ChatCompletionChunk> {
  return event.delta ? [createChunk(state, { content: event.delta }, null)] : []
}

function translateOutputItemAddedEvent(
  event: ResponsesStreamEvent,
  state: ResponsesStreamState,
): Array<ChatCompletionChunk> {
  if (
    event.output_index === undefined
    || !event.item
    || event.item.type !== "function_call"
  ) {
    return []
  }

  const toolIndex = state.nextToolIndex++
  state.toolIndexes.set(event.output_index, toolIndex)
  return [
    createChunk(
      state,
      {
        tool_calls: [
          {
            index: toolIndex,
            id: event.item.call_id,
            type: "function",
            function: {
              name: event.item.name,
              arguments: "",
            },
          },
        ],
      },
      null,
    ),
  ]
}

function translateFunctionArgumentsDeltaEvent(
  event: ResponsesStreamEvent,
  state: ResponsesStreamState,
): Array<ChatCompletionChunk> {
  if (event.output_index === undefined || !event.delta) return []
  const toolIndex = state.toolIndexes.get(event.output_index)
  if (toolIndex === undefined) return []

  return [
    createChunk(
      state,
      {
        tool_calls: [
          {
            index: toolIndex,
            function: { arguments: event.delta },
          },
        ],
      },
      null,
    ),
  ]
}

function translateFinishedEvent(
  event: ResponsesStreamEvent,
  state: ResponsesStreamState,
): Array<ChatCompletionChunk> {
  if (!event.response) return []
  updateStateFromResponse(event.response, state)

  return [
    {
      ...createChunk(state, {}, finishReason(event.response)),
      usage:
        event.response.usage ?
          {
            prompt_tokens: event.response.usage.input_tokens,
            completion_tokens: event.response.usage.output_tokens,
            total_tokens: event.response.usage.total_tokens,
            prompt_tokens_details: {
              cached_tokens:
                event.response.usage.input_tokens_details?.cached_tokens ?? 0,
            },
          }
        : undefined,
    },
  ]
}

function updateStateFromResponse(
  response: ResponsesResponse,
  state: ResponsesStreamState,
): void {
  state.id = response.id
  state.model = response.model
  state.created = response.created_at
}

function createChunk(
  state: ResponsesStreamState,
  delta: ChatCompletionChunk["choices"][number]["delta"],
  finishReasonValue: "stop" | "length" | "tool_calls" | "content_filter" | null,
): ChatCompletionChunk {
  return {
    id: state.id,
    object: "chat.completion.chunk",
    created: state.created,
    model: state.model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReasonValue,
        logprobs: null,
      },
    ],
  }
}
