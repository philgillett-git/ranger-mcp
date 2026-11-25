#!/usr/bin/env node
/**
 * Smoke test for @rangerwild/mcp-server.
 *
 * Spawns the compiled stdio MCP server, sends JSON-RPC envelopes, asserts
 * the expected catalogue + behaviours. Exits 0 on all PASS; 1 on any FAIL.
 *
 * Requires:
 *   RANGER_API_KEY — an rwk_live_* / rwk_test_* key, scope at minimum
 *                    `animals:read`, `species:read`, `actions:write`,
 *                    `dashboard:read`. Create at
 *                    station.rangerwild.com/settings/api-keys.
 * Optional:
 *   RANGER_API_URL — default https://station.rangerwild.com/api/v1
 *   SMOKE_WRITE_ANIMAL_ID — animal id to use for the log_weight write test.
 *                    When unset the smoke runs read-only.
 *
 * WHY we don't require a write today:
 * Prod animals shouldn't get spurious weights from CI runs. A dedicated
 * test animal id is set via env when Phil wants to exercise the write
 * path; otherwise read-only smoke still proves transport + catalogue.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dist = join(__dirname, '..', 'dist', 'index.js')

const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))

let pass = 0
let fail = 0
const failures = []

function ok(name) {
  pass++
  process.stdout.write(`  PASS  ${name}\n`)
}
function bad(name, reason) {
  fail++
  failures.push(`${name} — ${reason}`)
  process.stdout.write(`  FAIL  ${name}  ${reason}\n`)
}

/** Minimal JSON-RPC client over the child's stdio. */
function startServer(env) {
  const child = spawn(process.execPath, [dist], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let buf = ''
  const pending = new Map()
  let nextId = 1
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buf += chunk
    let idx
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch { continue }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.error) reject(new Error(`${msg.error.code ?? '?'}: ${msg.error.message ?? 'unknown'}`))
        else resolve(msg.result)
      }
    }
  })
  child.stderr.setEncoding('utf8')
  const stderrBuf = []
  child.stderr.on('data', (c) => stderrBuf.push(c))
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    const envelope = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'
    child.stdin.write(envelope)
  })
  return { child, send, stderr: () => stderrBuf.join('') }
}

async function main() {
  process.stdout.write(`\n@rangerwild/mcp-server v${pkg.version} smoke test\n`)
  process.stdout.write(`  server: ${dist}\n\n`)

  // Case 0: --list-tools dry-run (no API key needed)
  {
    const result = await new Promise((resolve, reject) => {
      const c = spawn(process.execPath, [dist, '--list-tools'], { env: { ...process.env, RANGER_API_KEY: '' } })
      let out = ''
      c.stdout.on('data', (d) => (out += d))
      c.on('close', (code) => code === 0 ? resolve(out) : reject(new Error(`exit ${code}`)))
    })
    const parsed = JSON.parse(result)
    if (parsed.tools.length === 20) ok('--list-tools returns 20 tools')
    else bad('--list-tools returns 20 tools', `got ${parsed.tools.length}`)
    const live = parsed.tools.filter((t) => t.status === 'live').length
    // Week 2 gateway has 7 live endpoints; search_animals_by_nickname is a
    // client-side filter over list_animals so it counts as the 8th live tool.
    if (live === 8) ok('--list-tools shows 8 live tools (7 gateway + 1 client-side filter)')
    else bad('--list-tools shows 8 live tools', `got ${live}`)
  }

  if (!process.env.RANGER_API_KEY) {
    process.stdout.write('\nRANGER_API_KEY not set — skipping transport + live-API smoke. Set it to run the full smoke.\n')
    process.stdout.write(`\n${pass} pass, ${fail} fail\n`)
    process.exit(fail > 0 ? 1 : 0)
    return
  }

  // Case 1: initialize over stdio
  const { child, send, stderr } = startServer({ RANGER_API_KEY: process.env.RANGER_API_KEY, RANGER_API_URL: process.env.RANGER_API_URL })

  try {
    const init = await send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'ranger-mcp-smoke', version: pkg.version },
    })
    if (init && init.capabilities && init.capabilities.tools !== undefined) ok('initialize returns capabilities.tools')
    else bad('initialize returns capabilities.tools', JSON.stringify(init).slice(0, 200))

    // Case 2: tools/list
    const listed = await send('tools/list', {})
    if (listed && Array.isArray(listed.tools) && listed.tools.length === 20) ok('tools/list returns 20 tools')
    else bad('tools/list returns 20 tools', `got ${listed?.tools?.length}`)

    // Case 3: tools/call get_dashboard_summary (LIVE)
    const dash = await send('tools/call', { name: 'get_dashboard_summary', arguments: {} })
    const dashText = dash?.content?.[0]?.text ?? ''
    const dashParsed = safeJson(dashText)
    if (dashParsed && dashParsed.park && dashParsed.totals) ok('tools/call get_dashboard_summary returns park + totals')
    else bad('tools/call get_dashboard_summary returns park + totals', dashText.slice(0, 200))

    // Case 4: tools/call list_animals (LIVE)
    const animals = await send('tools/call', { name: 'list_animals', arguments: { limit: 5 } })
    const animalsText = animals?.content?.[0]?.text ?? ''
    const animalsParsed = safeJson(animalsText)
    if (animalsParsed && Array.isArray(animalsParsed.animals)) ok('tools/call list_animals returns an array')
    else bad('tools/call list_animals returns an array', animalsText.slice(0, 200))

    // Case 5: tools/call list_enclosures (PENDING — expect friendly stub)
    const enclosures = await send('tools/call', { name: 'list_enclosures', arguments: {} })
    const enclosuresText = enclosures?.content?.[0]?.text ?? ''
    const enclosuresParsed = safeJson(enclosuresText)
    if (enclosuresParsed && enclosuresParsed.status === 'pending' && typeof enclosuresParsed.message === 'string') ok('pending tool returns {status: "pending", message}')
    else bad('pending tool returns {status: "pending", message}', enclosuresText.slice(0, 200))

    // Case 6: write — only if SMOKE_WRITE_ANIMAL_ID is set
    if (process.env.SMOKE_WRITE_ANIMAL_ID) {
      const weight = await send('tools/call', {
        name: 'log_weight',
        arguments: { animal_id: process.env.SMOKE_WRITE_ANIMAL_ID, kg: 1.23, keeper: 'mcp-smoke', notes: 'smoke test, auto-generated' },
      })
      const weightText = weight?.content?.[0]?.text ?? ''
      const weightParsed = safeJson(weightText)
      if (weightParsed && weightParsed.success && weightParsed.audit_id) ok('tools/call log_weight returns success + audit_id')
      else bad('tools/call log_weight returns success + audit_id', weightText.slice(0, 300))
    } else {
      process.stdout.write('  SKIP  log_weight (SMOKE_WRITE_ANIMAL_ID not set)\n')
    }

    // Case 7: unknown tool returns isError
    const unknown = await send('tools/call', { name: 'does_not_exist', arguments: {} })
    if (unknown?.isError) ok('unknown tool returns isError:true')
    else bad('unknown tool returns isError:true', JSON.stringify(unknown).slice(0, 200))
  } catch (err) {
    bad('smoke transport', err instanceof Error ? err.message : String(err))
    process.stderr.write(`\nserver stderr:\n${stderr()}\n`)
  } finally {
    child.kill('SIGTERM')
  }

  process.stdout.write(`\n${pass} pass, ${fail} fail\n`)
  if (fail > 0) {
    process.stdout.write('\nfailures:\n')
    for (const f of failures) process.stdout.write(`  - ${f}\n`)
  }
  process.exit(fail > 0 ? 1 : 0)
}

function safeJson(s) {
  try { return JSON.parse(s) } catch { return null }
}

main()
