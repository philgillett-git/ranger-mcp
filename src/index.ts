#!/usr/bin/env node
/**
 * @rangerwild/mcp-server — Model Context Protocol server for Ranger Wild.
 *
 * Users install this in Claude Desktop (or Cursor, or ChatGPT custom
 * tools) with one JSON config entry. The MCP client spawns this process
 * over stdio; `initialize` / `tools/list` / `tools/call` messages flow
 * in; this server translates each `tools/call` into an HTTP request
 * against the Ranger public API gateway using the operator's API key.
 *
 * WHY stdio transport (not SSE):
 * Claude Desktop installs a local binary via npx. Stdio is the standard
 * local-MCP transport and needs no public URL. For hosted MCP (future),
 * SSE would be bolted on in a separate entry point under src/.
 *
 * WHY no tool registration via the SDK's `registerTool` helper:
 * The server-side SDK's recommended pattern is to pass each tool to
 * `server.setRequestHandler(CallToolRequestSchema, ...)` + a parallel
 * `ListToolsRequestSchema` handler. We do exactly that below, driven
 * by the catalogue in `./tools.ts`.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { loadConfig } from './config'
import { RangerApiClient, type ApiError } from './api-client'
import { buildTools, type ToolDef } from './tools'

const PKG_NAME = '@rangerwild/mcp-server'
const PKG_VERSION = '0.1.0'

function toolsByName(tools: ToolDef[]): Map<string, ToolDef> {
  const map = new Map<string, ToolDef>()
  for (const t of tools) map.set(t.name, t)
  return map
}

async function main(): Promise<void> {
  // CLI dry-run paths (help / version) — these let `node dist/index.js --help`
  // succeed without RANGER_API_KEY so the workspace-level build check in
  // preflight doesn't need live credentials.
  const arg = process.argv[2]
  if (arg === '--help' || arg === '-h') {
    process.stdout.write(
      [
        `${PKG_NAME} v${PKG_VERSION}`,
        '',
        'Model Context Protocol server for Ranger Wild. Usage: install in Claude',
        'Desktop (or any MCP client) with your RANGER_API_KEY env var. See the',
        'README for the full install snippet.',
        '',
        'This binary speaks stdio MCP — spawn it from your MCP client, not from',
        'a terminal. Running it interactively will block waiting for JSON-RPC.',
        '',
        'Env:',
        '  RANGER_API_KEY   required — your rwk_live_* key from station.rangerwild.com/settings/api-keys',
        '  RANGER_API_URL   optional — default https://station.rangerwild.com/api/v1',
        '',
      ].join('\n'),
    )
    return
  }
  if (arg === '--version' || arg === '-v') {
    process.stdout.write(`${PKG_VERSION}\n`)
    return
  }
  if (arg === '--list-tools') {
    // Useful for the smoke test's quick-list check without spinning up a
    // full MCP transport.
    const tools = buildTools()
    process.stdout.write(JSON.stringify({ tools: tools.map((t) => ({ name: t.name, status: t.status, description: t.description })) }, null, 2) + '\n')
    return
  }

  const cfg = loadConfig()
  const client = new RangerApiClient(cfg)
  const tools = buildTools()
  const byName = toolsByName(tools)

  const server = new Server(
    { name: PKG_NAME, version: PKG_VERSION },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description + (t.status === 'pending' ? ' (Pending — not yet live.)' : ''),
      inputSchema: t.inputSchema,
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name
    const args = (req.params.arguments ?? {}) as Record<string, unknown>
    const tool = byName.get(name)
    if (!tool) {
      return {
        content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
        isError: true,
      }
    }
    try {
      const result = await tool.handler(client, args)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      }
    } catch (err) {
      const e = err as ApiError
      const envelope = {
        error: {
          code: e.code ?? 'unknown_error',
          message: e.message,
          status: e.status,
          details: e.details,
        },
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(envelope, null, 2) }],
        isError: true,
      }
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
  // The transport keeps the process alive via stdin. Nothing more to do here.
}

main().catch((err) => {
  process.stderr.write(`[${PKG_NAME}] fatal: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
