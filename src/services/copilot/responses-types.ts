export interface ResponsesPayload {
  model: string
  input: Array<ResponseInputItem>
  instructions?: string
  max_output_tokens?: number | null
  stream?: boolean | null
  temperature?: number | null
  top_p?: number | null
  tools?: Array<ResponseFunctionTool>
  tool_choice?:
    "none" | "auto" | "required" | { type: "function"; name: string }
  user?: string | null
  store: false
}

export type ResponseInputItem =
  ResponseInputMessage | ResponseFunctionCall | ResponseFunctionCallOutput

export interface ResponseInputMessage {
  role: "user" | "assistant"
  content: Array<ResponseInputContent | ResponseOutputContent>
}

export type ResponseInputContent = ResponseInputText | ResponseInputImage

interface ResponseInputText {
  type: "input_text"
  text: string
}

interface ResponseInputImage {
  type: "input_image"
  image_url: string
}

export interface ResponseOutputText {
  type: "output_text"
  text: string
  annotations?: Array<unknown>
  logprobs?: Array<unknown>
}

interface ResponseRefusal {
  type: "refusal"
  refusal: string
}

export type ResponseOutputContent = ResponseOutputText | ResponseRefusal

export interface ResponseFunctionCall {
  type: "function_call"
  call_id: string
  name: string
  arguments: string
  id?: string
  status?: string
}

interface ResponseFunctionCallOutput {
  type: "function_call_output"
  call_id: string
  output: string
}

export interface ResponseFunctionTool {
  type: "function"
  name: string
  description?: string
  parameters: Record<string, unknown>
}

export interface ResponsesResponse {
  id: string
  object: "response"
  created_at: number
  model: string
  status: "completed" | "failed" | "incomplete" | "in_progress"
  incomplete_details?: {
    reason?: string
  } | null
  output: Array<ResponseOutputItem>
  usage?: ResponsesUsage | null
  error?: {
    code?: string
    message: string
  } | null
}

export type ResponseOutputItem =
  ResponseOutputMessage | ResponseFunctionCall | ResponseReasoningItem

export interface ResponseOutputMessage {
  type: "message"
  role: "assistant"
  content: Array<ResponseOutputContent>
  id?: string
  status?: string
}

interface ResponseReasoningItem {
  type: "reasoning"
  id?: string
  summary?: Array<unknown>
}

export interface ResponsesUsage {
  input_tokens: number
  output_tokens: number
  total_tokens: number
  input_tokens_details?: {
    cached_tokens?: number
    cache_write_tokens?: number
  }
  output_tokens_details?: {
    reasoning_tokens?: number
  }
}

export interface ResponsesStreamEvent {
  type: string
  response?: ResponsesResponse
  item?: ResponseOutputItem
  output_index?: number
  delta?: string
  error?: {
    code?: string
    message: string
  }
}

export interface ResponsesStreamState {
  id: string
  model: string
  created: number
  toolIndexes: Map<number, number>
  nextToolIndex: number
}
