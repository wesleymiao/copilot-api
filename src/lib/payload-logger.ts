import type { MiddlewareHandler } from "hono"
import consola from "consola"

const MAX_PREVIEW_LENGTH = 80

interface ContentBlock {
  type?: string
  text?: string
  name?: string
  content?: string | Array<{ type?: string; text?: string }>
  tool_use_id?: string
  is_error?: boolean
}

interface MessageLike {
  role?: string
  content?: string | Array<ContentBlock>
}

/**
 * Extract text content from a tool_result block.
 */
function extractToolResultText(block: ContentBlock): string {
  if (typeof block.content === "string") {
    return block.content
  }
  if (Array.isArray(block.content)) {
    for (const item of block.content) {
      if (item.type === "text" && item.text) {
        return item.text
      }
    }
  }
  return ""
}

/**
 * Extract a short preview from assistant response content blocks.
 */
function getResponseContentPreview(
  blocks: Array<{ type?: string; text?: string; name?: string }>,
): string {
  for (const block of blocks) {
    if (block.type === "tool_use" && block.name) {
      const toolNames = blocks
        .filter((b) => b.type === "tool_use" && b.name)
        .map((b) => b.name)
      return `[tool_use: ${toolNames.join(", ")}]`
    }
    if (block.type === "text" && block.text) {
      const clean = block.text.replace(/\s+/g, " ").trim()
      if (clean.length > MAX_PREVIEW_LENGTH) {
        return `"${clean.slice(0, MAX_PREVIEW_LENGTH)}..."`
      }
      return `"${clean}"`
    }
  }
  if (blocks.length > 0) {
    const types = blocks.map((b) => b.type ?? "unknown")
    return `[${types.join(", ")}]`
  }
  return ""
}

/**
 * Extract a short text preview from the last user message.
 */
function getLastMessagePreview(messages: Array<MessageLike>): string {
  // Walk backwards to find the last user message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== "user") continue

    let text = ""
    if (typeof msg.content === "string") {
      text = msg.content
    } else if (Array.isArray(msg.content)) {
      // Find the first text block
      for (const block of msg.content) {
        if (block.type === "text" && block.text) {
          text = block.text
          break
        }
        if (block.type === "tool_result") {
          const errorTag = block.is_error ? "error " : ""
          const resultText = extractToolResultText(block)
          if (resultText) {
            const clean = resultText.replace(/\s+/g, " ").trim()
            const truncated =
              clean.length > MAX_PREVIEW_LENGTH
                ? `${clean.slice(0, MAX_PREVIEW_LENGTH)}...`
                : clean
            text = `[${errorTag}tool_result: "${truncated}"]`
          } else {
            text = `[${errorTag}tool_result]`
          }
          break
        }
      }
      if (!text) {
        // Summarize block types
        const types = msg.content.map((b) => b.type ?? "unknown")
        return `[${types.join(", ")}]`
      }
    }

    if (text) {
      // Collapse whitespace and truncate
      const clean = text.replace(/\s+/g, " ").trim()
      if (clean.length > MAX_PREVIEW_LENGTH) {
        return `"${clean.slice(0, MAX_PREVIEW_LENGTH)}..."`
      }
      return `"${clean}"`
    }
  }
  return ""
}

export function payloadLogger(): MiddlewareHandler {
  return async (c, next) => {
    const method = c.req.method
    const path = c.req.path
    const query = c.req.query()
    const queryStr = Object.keys(query).length
      ? `?${new URLSearchParams(query).toString()}`
      : ""

    // Try to extract payload summary for POST requests
    let payloadInfo = ""
    if (method === "POST") {
      try {
        const contentType = c.req.header("content-type") ?? ""
        if (contentType.includes("application/json")) {
          // Parse from the request body without cloning the entire payload.
          // c.req.json() is cached by Hono, so downstream handlers still work.
          const body = (await c.req.json()) as Record<string, unknown>
          const parts: string[] = []

          if (body.model) parts.push(`model=${body.model}`)
          if (Array.isArray(body.messages))
            parts.push(`msgs=${body.messages.length}`)
          if (body.stream !== undefined) parts.push(`stream=${body.stream}`)
          if (body.max_tokens) parts.push(`max_tokens=${body.max_tokens}`)
          if (Array.isArray(body.tools))
            parts.push(`tools=${body.tools.length}`)

          // Add a preview of the last user message
          if (Array.isArray(body.messages)) {
            const preview = getLastMessagePreview(
              body.messages as Array<MessageLike>,
            )
            if (preview) parts.push(`last_msg=${preview}`)
          }

          if (parts.length > 0) {
            payloadInfo = ` [${parts.join(", ")}]`
          }
        }
      } catch {
        // Not JSON or can't parse, skip
      }
    }

    consola.info(`<-- ${method} ${path}${queryStr}${payloadInfo}`)

    const start = Date.now()
    await next()
    const duration = Date.now() - start

    const durationStr =
      duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`

    // Try to extract response payload summary
    let responseInfo = ""
    const resContentType = c.res.headers.get("content-type") ?? ""
    if (resContentType.includes("application/json") && c.res.body) {
      try {
        // Clone only small JSON responses to avoid doubling memory for large payloads
        const contentLength = parseInt(c.res.headers.get("content-length") ?? "0", 10)
        if (contentLength === 0 || contentLength < 65536) {
          const cloned = c.res.clone()
          const resBody = (await cloned.json()) as Record<string, unknown>
          const parts: string[] = []

          if (resBody.stop_reason) parts.push(`stop=${resBody.stop_reason}`)

          const usage = resBody.usage as
            | Record<string, number | undefined>
            | undefined
          if (usage) {
            if (usage.input_tokens != null)
              parts.push(`in=${usage.input_tokens}`)
            if (usage.output_tokens != null)
              parts.push(`out=${usage.output_tokens}`)
            if (usage.cache_read_input_tokens)
              parts.push(`cache_read=${usage.cache_read_input_tokens}`)
            if (usage.cache_creation_input_tokens)
              parts.push(`cache_create=${usage.cache_creation_input_tokens}`)
          }

          // Preview of response content
          if (Array.isArray(resBody.content)) {
            const contentBlocks = resBody.content as Array<{
              type?: string
              text?: string
              name?: string
            }>
            const preview = getResponseContentPreview(contentBlocks)
            if (preview) parts.push(`content=${preview}`)
          }

          if (parts.length > 0) {
            responseInfo = ` [${parts.join(", ")}]`
          }
        }
      } catch {
        // Can't parse response, skip
      }
    } else if (resContentType.includes("text/event-stream")) {
      responseInfo = " [streaming]"
    }

    consola.info(
      `--> ${method} ${path}${queryStr} ${c.res.status} ${durationStr}${responseInfo}`,
    )
  }
}
