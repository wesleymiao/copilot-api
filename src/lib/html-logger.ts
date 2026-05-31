import type { MiddlewareHandler } from "hono"
import fs from "node:fs"
import path from "node:path"
import { PATHS } from "./paths"
import { state } from "./state"

const HTML_HEADER = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Copilot API Logs</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0d1117; color: #c9d1d9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; padding: 16px; }
  h1 { color: #58a6ff; margin-bottom: 8px; font-size: 1.4em; }
  #controls { position: sticky; top: 0; background: #0d1117; padding: 8px 0 12px; z-index: 10; border-bottom: 1px solid #21262d; margin-bottom: 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  #search { background: #161b22; border: 1px solid #30363d; color: #c9d1d9; padding: 6px 10px; border-radius: 6px; width: 300px; font-size: 14px; }
  #search:focus { outline: none; border-color: #58a6ff; }
  .btn { background: #21262d; border: 1px solid #30363d; color: #c9d1d9; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; }
  .btn:hover { background: #30363d; }
  .btn.active { background: #1f6feb; border-color: #1f6feb; }
  .count { color: #8b949e; font-size: 13px; margin-left: auto; }
  .entry { background: #161b22; border: 1px solid #21262d; border-radius: 8px; margin-bottom: 8px; overflow: hidden; }
  .entry-header { padding: 10px 14px; cursor: pointer; display: flex; align-items: center; gap: 10px; user-select: none; }
  .entry-header:hover { background: #1c2128; }
  .method { font-weight: 700; font-size: 12px; padding: 2px 6px; border-radius: 4px; }
  .method-GET { background: #238636; color: #fff; }
  .method-POST { background: #1f6feb; color: #fff; }
  .method-PUT { background: #d29922; color: #fff; }
  .method-DELETE { background: #da3633; color: #fff; }
  .path { color: #58a6ff; font-family: monospace; font-size: 13px; }
  .status { font-family: monospace; font-size: 13px; }
  .status-2xx { color: #3fb950; }
  .status-4xx { color: #d29922; }
  .status-5xx { color: #f85149; }
  .duration { color: #8b949e; font-size: 12px; }
  .time { color: #8b949e; font-size: 12px; margin-left: auto; }
  .model-tag { background: #30363d; color: #e6edf3; font-size: 11px; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
  .arrow { color: #484f58; transition: transform 0.15s; font-size: 12px; }
  .arrow.open { transform: rotate(90deg); }
  .entry-body { display: none; border-top: 1px solid #21262d; }
  .entry-body.open { display: block; }
  .section { padding: 10px 14px; }
  .section-title { color: #8b949e; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
  .json-container { background: #0d1117; border: 1px solid #21262d; border-radius: 6px; padding: 10px; overflow-x: auto; max-height: 600px; overflow-y: auto; font-family: 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 12px; line-height: 1.6; }
  .jt-row { display: flex; align-items: flex-start; }
  .jt-toggle { cursor: pointer; user-select: none; color: #484f58; width: 1.2em; flex-shrink: 0; text-align: center; }
  .jt-toggle:hover { color: #c9d1d9; }
  .jt-key { color: #79c0ff; margin-right: 4px; }
  .jt-str { color: #a5d6ff; }
  .jt-num { color: #56d364; }
  .jt-bool { color: #ff7b72; }
  .jt-null { color: #484f58; font-style: italic; }
  .jt-bracket { color: #6e7681; }
  .jt-children { padding-left: 1.4em; }
  .jt-children.collapsed { display: none; }
  .jt-summary { color: #484f58; font-style: italic; cursor: pointer; }
  .jt-comma { color: #6e7681; }
  .jt-str-long { max-width: 600px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: inline-block; vertical-align: bottom; cursor: pointer; }
  .jt-str-long.expanded { white-space: pre-wrap; max-width: none; word-break: break-word; }
  .streaming-tag { background: #30363d; color: #d2a8ff; font-size: 11px; padding: 2px 6px; border-radius: 4px; }
</style>
</head>
<body>
<h1>Copilot API Request Logs</h1>
<div id="controls">
  <input type="text" id="search" placeholder="Filter by path, model, content..." />
  <button class="btn" onclick="toggleAll(true)">Expand All</button>
  <button class="btn" onclick="toggleAll(false)">Collapse All</button>
  <button class="btn" onclick="clearEntries()">Clear View</button>
  <span class="count" id="count"></span>
</div>
<div id="entries"></div>
<script>
window.ENTRIES = [];

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function jsonTree(val, key, isLast) {
  var comma = isLast ? '' : '<span class="jt-comma">,</span>';
  var keyHtml = key !== null ? '<span class="jt-key">' + escapeHtml(JSON.stringify(key)) + '</span>: ' : '';

  if (val === null) return '<div class="jt-row"><span class="jt-toggle"> </span>' + keyHtml + '<span class="jt-null">null</span>' + comma + '</div>';
  if (typeof val === 'boolean') return '<div class="jt-row"><span class="jt-toggle"> </span>' + keyHtml + '<span class="jt-bool">' + val + '</span>' + comma + '</div>';
  if (typeof val === 'number') return '<div class="jt-row"><span class="jt-toggle"> </span>' + keyHtml + '<span class="jt-num">' + val + '</span>' + comma + '</div>';
  if (typeof val === 'string') {
    var escaped = escapeHtml(JSON.stringify(val));
    if (val.length > 120) {
      return '<div class="jt-row"><span class="jt-toggle"> </span>' + keyHtml + '<span class="jt-str jt-str-long" data-action="expand-str" title="Click to expand">' + escaped + '</span>' + comma + '</div>';
    }
    return '<div class="jt-row"><span class="jt-toggle"> </span>' + keyHtml + '<span class="jt-str">' + escaped + '</span>' + comma + '</div>';
  }

  var isArr = Array.isArray(val);
  var entries = isArr ? val.map(function(v, i) { return [i, v]; }) : Object.entries(val);
  var open = isArr ? '[' : '{';
  var close = isArr ? ']' : '}';
  var count = entries.length;
  var summary = isArr ? count + ' items' : count + ' keys';
  var id = 'jt-' + Math.random().toString(36).slice(2, 10);

  var html = '<div class="jt-row">';
  html += '<span class="jt-toggle" data-action="toggle-tree" data-target="' + id + '">\u25BC</span>';
  html += keyHtml + '<span class="jt-bracket">' + open + '</span>';
  html += ' <span class="jt-summary" data-action="toggle-tree" data-target="' + id + '">' + summary + '</span>';
  html += '</div>';
  html += '<div class="jt-children" id="' + id + '">';
  entries.forEach(function(pair, i) { html += jsonTree(pair[1], isArr ? null : pair[0], i === count - 1); });
  html += '</div>';
  html += '<div class="jt-row"><span class="jt-toggle"> </span><span class="jt-bracket">' + close + '</span>' + comma + '</div>';
  return html;
}

function renderJson(data) {
  return '<div class="json-container">' + jsonTree(data, null, true) + '</div>';
}

document.addEventListener('click', function(ev) {
  var el = ev.target;
  if (!el) return;
  var action = el.getAttribute('data-action');
  if (action === 'toggle-tree') {
    var targetId = el.getAttribute('data-target');
    var children = document.getElementById(targetId);
    if (!children) return;
    children.classList.toggle('collapsed');
    var row = children.previousElementSibling;
    if (row) {
      var toggler = row.querySelector('[data-action="toggle-tree"].jt-toggle');
      if (toggler) toggler.textContent = children.classList.contains('collapsed') ? '\u25B6' : '\u25BC';
    }
  } else if (action === 'expand-str') {
    el.classList.toggle('expanded');
  }
});

function statusClass(s) { if (s >= 500) return 'status-5xx'; if (s >= 400) return 'status-4xx'; return 'status-2xx'; }

function renderEntry(e, i) {
  const model = e.request?.model || '';
  const isStream = e.response?.streaming;
  return '<div class="entry" data-idx="'+i+'" data-search="'+escapeHtml((e.path+' '+model+' '+JSON.stringify(e.request)+' '+JSON.stringify(e.response)).toLowerCase())+'">' +
    '<div class="entry-header" onclick="toggle('+i+')">' +
      '<span class="arrow" id="arrow-'+i+'">&#9654;</span>' +
      '<span class="method method-'+e.method+'">'+e.method+'</span>' +
      '<span class="path">'+escapeHtml(e.path)+'</span>' +
      '<span class="status '+statusClass(e.status)+'">'+e.status+'</span>' +
      '<span class="duration">'+e.duration+'</span>' +
      (model ? '<span class="model-tag">'+escapeHtml(model)+'</span>' : '') +
      (isStream ? '<span class="streaming-tag">streaming</span>' : '') +
      '<span class="time">'+e.time+'</span>' +
    '</div>' +
    '<div class="entry-body" id="body-'+i+'">' +
      '<div class="section"><div class="section-title">Request</div>'+renderJson(e.request)+'</div>' +
      '<div class="section"><div class="section-title">Response</div>'+renderJson(e.response)+'</div>' +
    '</div>' +
  '</div>';
}

function renderAll() {
  const q = document.getElementById('search').value.toLowerCase();
  const el = document.getElementById('entries');
  let html = '', shown = 0;
  for (let i = window.ENTRIES.length - 1; i >= 0; i--) {
    const e = window.ENTRIES[i];
    const searchStr = (e.path+' '+(e.request?.model||'')+' '+JSON.stringify(e.request)+' '+JSON.stringify(e.response)).toLowerCase();
    if (q && searchStr.indexOf(q) === -1) continue;
    html += renderEntry(e, i);
    shown++;
  }
  el.innerHTML = html;
  document.getElementById('count').textContent = shown + ' / ' + window.ENTRIES.length + ' entries';
}

function toggle(i) {
  const body = document.getElementById('body-'+i);
  const arrow = document.getElementById('arrow-'+i);
  if (body) { body.classList.toggle('open'); arrow.classList.toggle('open'); }
}

function toggleAll(open) {
  document.querySelectorAll('.entry-body').forEach(el => { open ? el.classList.add('open') : el.classList.remove('open'); });
  document.querySelectorAll('.arrow').forEach(el => { open ? el.classList.add('open') : el.classList.remove('open'); });
}

function clearEntries() { window.ENTRIES = []; renderAll(); }

document.getElementById('search').addEventListener('input', renderAll);

// Auto-render when new entries are pushed
const origPush = Array.prototype.push;
window._render = renderAll;
</script>
`

const HTML_ENTRY_TEMPLATE = (filename: string) =>
  `<script src="log-entries/${filename}"></script>\n`

let initialized = false
let entryCounter = 0

function ensureHtmlFile(): void {
  if (initialized) return
  fs.mkdirSync(PATHS.HTML_LOG_ENTRIES_DIR, { recursive: true })
  try {
    const stat = fs.statSync(PATHS.HTML_LOG_PATH)
    if (stat.size === 0) {
      fs.writeFileSync(PATHS.HTML_LOG_PATH, HTML_HEADER)
    }
    // Count existing entries to continue numbering
    try {
      const files = fs.readdirSync(PATHS.HTML_LOG_ENTRIES_DIR)
      entryCounter = files.length
    } catch {
      // ignore
    }
  } catch {
    fs.writeFileSync(PATHS.HTML_LOG_PATH, HTML_HEADER)
  }
  initialized = true
}

function appendEntry(entry: Record<string, unknown>): void {
  const data = JSON.stringify(entry)
  const timestamp = Date.now()
  const filename = `${String(entryCounter).padStart(5, "0")}-${timestamp}.js`
  entryCounter++

  // Write entry data to separate file
  fs.writeFileSync(
    path.join(PATHS.HTML_LOG_ENTRIES_DIR, filename),
    `window.ENTRIES.push(${data.replace(/<\//g, "<\\/")});window._render();\n`,
  )

  // Append script reference to HTML
  fs.appendFileSync(PATHS.HTML_LOG_PATH, HTML_ENTRY_TEMPLATE(filename))
}

interface AssembledContent {
  type: string
  text?: string
  id?: string
  name?: string
  input?: unknown
}

interface AssembledResponse {
  streaming: true
  id?: string
  model?: string
  stop_reason?: string
  usage?: Record<string, unknown>
  content: AssembledContent[]
}

function assembleStreamEvents(
  events: Record<string, unknown>[],
): AssembledResponse {
  const result: AssembledResponse = {
    streaming: true,
    content: [],
  }

  // Track content blocks by index
  const blocks: Map<number, AssembledContent> = new Map()

  for (const event of events) {
    const type = event.type as string

    if (type === "message_start") {
      const msg = event.message as Record<string, unknown> | undefined
      if (msg) {
        result.id = msg.id as string
        result.model = msg.model as string
        if (msg.usage) result.usage = msg.usage as Record<string, unknown>
      }
    } else if (type === "content_block_start") {
      const index = event.index as number
      const cb = event.content_block as Record<string, unknown>
      if (cb.type === "text") {
        blocks.set(index, { type: "text", text: "" })
      } else if (cb.type === "tool_use") {
        blocks.set(index, {
          type: "tool_use",
          id: cb.id as string,
          name: cb.name as string,
          input: {},
        })
      }
    } else if (type === "content_block_delta") {
      const index = event.index as number
      const delta = event.delta as Record<string, unknown>
      const block = blocks.get(index)
      if (!block) continue

      if (delta.type === "text_delta") {
        block.text = (block.text ?? "") + (delta.text as string)
      } else if (delta.type === "input_json_delta") {
        // Accumulate partial JSON for tool input
        block.input =
          ((block.input as string | undefined) ?? "") +
          (delta.partial_json as string)
      }
    } else if (type === "content_block_stop") {
      const index = event.index as number
      const block = blocks.get(index)
      if (block?.type === "tool_use" && typeof block.input === "string") {
        try {
          block.input = JSON.parse(block.input)
        } catch {
          // keep as string
        }
      }
    } else if (type === "message_delta") {
      const delta = event.delta as Record<string, unknown> | undefined
      if (delta?.stop_reason) result.stop_reason = delta.stop_reason as string
      const usage = event.usage as Record<string, unknown> | undefined
      if (usage) result.usage = { ...result.usage, ...usage }
    }
  }

  // Build content array in order
  const sortedKeys = [...blocks.keys()].sort((a, b) => a - b)
  for (const key of sortedKeys) {
    result.content.push(blocks.get(key)!)
  }

  return result
}

export function htmlLogger(): MiddlewareHandler {
  return async (c, next) => {
    if (!state.htmlLog) {
      await next()
      return
    }

    ensureHtmlFile()

    const method = c.req.method
    const path = c.req.path
    const time = new Date().toISOString()

    // Capture request body
    let requestBody: unknown = null
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      try {
        requestBody = await c.req.raw.clone().json()
      } catch {
        try {
          requestBody = await c.req.raw.clone().text()
        } catch {
          // ignore
        }
      }
    }

    const start = Date.now()
    await next()
    const duration = Date.now() - start
    const durationStr =
      duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`

    // Capture response body
    let responseBody: unknown = null
    const contentType = c.res.headers.get("content-type") ?? ""

    if (contentType.includes("text/event-stream") && c.res.body) {
      // Tee the SSE stream: one branch goes to the client, the other we collect for logging
      const originalBody = c.res.body
      const [clientStream, logStream] = originalBody.tee()

      // Replace response with the client branch
      c.res = new Response(clientStream, {
        status: c.res.status,
        headers: c.res.headers,
      })

      // Collect SSE events in background, assemble into readable response, then log
      const reader = logStream.getReader()
      const decoder = new TextDecoder()
      const collectAndLog = async () => {
        const events: Record<string, unknown>[] = []
        let buffer = ""
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split("\n")
            buffer = lines.pop() ?? ""
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6).trim()
                if (data === "[DONE]") continue
                try {
                  events.push(JSON.parse(data) as Record<string, unknown>)
                } catch {
                  // skip unparseable
                }
              }
            }
          }
        } catch {
          // stream error, log what we have
        }

        // Assemble events into a readable response
        const assembled = assembleStreamEvents(events)

        const elapsed = Date.now() - start
        const dur =
          elapsed < 1000 ? `${elapsed}ms` : `${(elapsed / 1000).toFixed(1)}s`
        appendEntry({
          method,
          path,
          status: c.res.status,
          duration: dur,
          time,
          request: requestBody,
          response: assembled,
        })
      }
      collectAndLog().catch(() => {})
      return
    } else if (c.res.body) {
      try {
        const cloned = c.res.clone()
        const text = await cloned.text()
        try {
          responseBody = JSON.parse(text)
        } catch {
          responseBody = text
        }
      } catch {
        // ignore
      }
    }

    appendEntry({
      method,
      path,
      status: c.res.status,
      duration: durationStr,
      time,
      request: requestBody,
      response: responseBody,
    })
  }
}
