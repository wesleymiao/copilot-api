import consola from "consola"
import { events } from "fetch-event-stream"

import { copilotBaseUrl, copilotHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

import type {
  ResponseInputMessage,
  ResponsesPayload,
  ResponsesResponse,
} from "./responses-types"

export async function createResponses(
  payload: ResponsesPayload,
  signal?: AbortSignal,
) {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const enableVision = payload.input.some(
    (item): item is ResponseInputMessage =>
      "role" in item
      && item.content.some((content) => content.type === "input_image"),
  )
  const isAgentCall = payload.input.some(
    (item) => "type" in item || ("role" in item && item.role === "assistant"),
  )

  const response = await fetch(`${copilotBaseUrl(state)}/responses`, {
    method: "POST",
    headers: {
      ...copilotHeaders(state, enableVision),
      "X-Initiator": isAgentCall ? "agent" : "user",
    },
    body: JSON.stringify(payload),
    signal,
  })

  if (!response.ok) {
    consola.error("Failed to create response", response)
    throw new HTTPError("Failed to create response", response)
  }

  if (payload.stream) {
    return events(response, signal)
  }

  return (await response.json()) as ResponsesResponse
}
