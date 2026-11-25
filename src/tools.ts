/**
 * Ranger MCP tool catalogue — 20 tools exposed to Claude Desktop / Cursor /
 * ChatGPT via the Model Context Protocol.
 *
 * 14 tools are LIVE:
 *   list_animals, get_animal, list_species, get_species,
 *   list_enclosures, get_enclosure, list_overdue_checks,
 *   list_recent_incidents, list_upcoming_events, list_api_activity_today,
 *   log_weight, log_feed, get_dashboard_summary,
 *   search_animals_by_nickname (served by list_animals + client-side filter).
 *
 * 6 tools are visible but PENDING (all writes):
 *   log_enrichment, log_vet_note, mark_check_done,
 *   raise_incident, add_note_to_animal, move_animal_to_enclosure.
 * These return a friendly "coming soon" message rather than hit a 404.
 *
 * WHY expose pending tools at all:
 * Phil's Knowsley wedge is the catalogue breadth — "no zoo software has
 * 20 AI-callable operations." A tool that says "coming soon" still
 * demonstrates the direction; a missing tool reads as a gap. Each pending
 * tool documents what it WILL do, so the operator's expectation matches
 * what lands when the write-side batch ships.
 */
import type { RangerApiClient } from './api-client'

export interface ToolDef {
  name: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
  status: 'live' | 'pending'
  handler: (client: RangerApiClient, args: Record<string, unknown>) => Promise<unknown>
}

/** Formatted "not live yet" stub so Claude Desktop can confirm/explain to the operator. */
function pending(toolName: string, weekLiveTarget: string, backingEndpoint: string): ToolDef['handler'] {
  return async () => ({
    status: 'pending',
    tool: toolName,
    message: `This tool will go live ${weekLiveTarget}. Backing endpoint ${backingEndpoint} is documented in the OpenAPI spec at developers.rangerwild.com but not yet reachable through the public gateway.`,
  })
}

/** Resolve an animal nickname → id via the live list endpoint. Returns null if ambiguous. */
async function resolveAnimalId(client: RangerApiClient, nickname: string): Promise<{ id: string; nickname: string } | null> {
  const resp = await client.get<{ animals: Array<{ id: string; nickname: string | null }> }>('/animals')
  const needle = nickname.trim().toLowerCase()
  const matches = (resp.animals ?? []).filter((a) => a.nickname && a.nickname.toLowerCase() === needle)
  if (matches.length === 1) return { id: matches[0].id, nickname: matches[0].nickname as string }
  return null
}

export function buildTools(): ToolDef[] {
  return [
    // ─────────────── READ (12) ───────────────
    {
      name: 'list_animals',
      description: 'List animals at the operator\'s centre. Returns id, nickname, and basic metadata for up to 500 animals.',
      inputSchema: {
        type: 'object',
        properties: {
          species: { type: 'string', description: 'Optional: filter by species display name (client-side filter in Week 3; server-side in Week 4).' },
          enclosure: { type: 'string', description: 'Optional: filter by enclosure name (same).' },
          status: { type: 'string', enum: ['active', 'deceased'], description: 'Optional: active (default) or deceased.' },
          limit: { type: 'integer', default: 100, maximum: 500 },
        },
      },
      status: 'live',
      handler: async (client, args) => {
        const resp = await client.get<{ animals: Array<Record<string, unknown>> }>('/animals')
        const limit = Math.min(Number(args.limit ?? 100), 500)
        return { animals: (resp.animals ?? []).slice(0, limit), count: Math.min(resp.animals?.length ?? 0, limit) }
      },
    },
    {
      name: 'get_animal',
      description: 'Fetch the full detail for one animal by id (uuid).',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Animal uuid.' } },
        required: ['id'],
      },
      status: 'live',
      handler: async (client, args) => client.get(`/animals/${encodeURIComponent(String(args.id))}`),
    },
    {
      name: 'list_species',
      description: 'List the species held at the operator\'s centre.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'integer', default: 100, maximum: 500 },
        },
      },
      status: 'live',
      handler: async (client, args) => {
        const resp = await client.get<{ species: Array<Record<string, unknown>> }>('/species')
        const limit = Math.min(Number(args.limit ?? 100), 500)
        return { species: (resp.species ?? []).slice(0, limit), count: Math.min(resp.species?.length ?? 0, limit) }
      },
    },
    {
      name: 'get_species',
      description: 'Fetch one species-at-this-centre record by species_id (uuid).',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Species uuid.' } },
        required: ['id'],
      },
      status: 'live',
      handler: async (client, args) => client.get(`/species/${encodeURIComponent(String(args.id))}`),
    },
    {
      name: 'list_enclosures',
      description: 'List enclosures at the operator\'s centre, ordered by sort_order.',
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'integer', default: 100, maximum: 500 } },
      },
      status: 'live',
      handler: async (client, args) => {
        const resp = await client.get<{ enclosures: Array<Record<string, unknown>> }>('/enclosures')
        const limit = Math.min(Number(args.limit ?? 100), 500)
        return { enclosures: (resp.enclosures ?? []).slice(0, limit), count: Math.min(resp.enclosures?.length ?? 0, limit) }
      },
    },
    {
      name: 'get_enclosure',
      description: 'Fetch one enclosure by id with its full detail (name, lat/lng, sort order).',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Enclosure uuid.' } },
        required: ['id'],
      },
      status: 'live',
      handler: async (client, args) => client.get(`/enclosures/${encodeURIComponent(String(args.id))}`),
    },
    {
      name: 'list_overdue_checks',
      description: 'List all check-template instances whose next-due timestamp is in the past (status=open, due_at < now).',
      inputSchema: { type: 'object', properties: {} },
      status: 'live',
      handler: async (client) => client.get('/checks/instances?state=overdue'),
    },
    {
      name: 'list_recent_incidents',
      description: 'List incidents raised in the last N days (default 7). Backed by the actions ledger with action_type_key=incident.',
      inputSchema: {
        type: 'object',
        properties: { days: { type: 'integer', default: 7, minimum: 1, maximum: 90 } },
      },
      status: 'live',
      handler: async (client, args) => {
        const days = Math.min(Math.max(1, Number(args.days ?? 7)), 90)
        const since = new Date(Date.now() - days * 24 * 60 * 60_000).toISOString()
        return client.get(`/incidents?since=${encodeURIComponent(since)}`)
      },
    },
    {
      name: 'get_dashboard_summary',
      description: 'High-level counts for the operator\'s centre (animals, species, enclosures) plus park name and kind. Good first call for context.',
      inputSchema: { type: 'object', properties: {} },
      status: 'live',
      handler: async (client) => client.get('/dashboard/summary'),
    },
    {
      name: 'list_upcoming_events',
      description: 'List events on the schedule for the next N days (default 7). Ordered by starts_at.',
      inputSchema: {
        type: 'object',
        properties: { days: { type: 'integer', default: 7, minimum: 1, maximum: 30 } },
      },
      status: 'live',
      handler: async (client, args) => {
        const days = Math.min(Math.max(1, Number(args.days ?? 7)), 30)
        const from = new Date().toISOString()
        const to = new Date(Date.now() + days * 24 * 60 * 60_000).toISOString()
        return client.get(`/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      },
    },
    {
      name: 'list_api_activity_today',
      description: 'List the audit log entries written by API-key callers today. Useful for "what has Claude Desktop done for me this morning".',
      inputSchema: { type: 'object', properties: {} },
      status: 'live',
      handler: async (client) => {
        // UK operator-facing: today = local midnight-to-now. Done in UTC
        // here because the audit log is tz-aware server-side; the BST/GMT
        // fringe cases are acceptable for an "activity today" tool (vs an
        // inspector-pack report which uses the park's timezone helper).
        const todayMidnight = new Date()
        todayMidnight.setHours(0, 0, 0, 0)
        const since = todayMidnight.toISOString()
        return client.get(`/audit?since=${encodeURIComponent(since)}&callerActorKind=api`)
      },
    },
    {
      name: 'search_animals_by_nickname',
      description: 'Find animals whose nickname matches a query. Case-insensitive substring match.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Nickname fragment to search for.' } },
        required: ['query'],
      },
      status: 'live',
      handler: async (client, args) => {
        const q = String(args.query ?? '').trim().toLowerCase()
        if (!q) return { matches: [], count: 0 }
        const resp = await client.get<{ animals: Array<{ id: string; nickname: string | null }> }>('/animals')
        const matches = (resp.animals ?? []).filter((a) => a.nickname && a.nickname.toLowerCase().includes(q))
        return { matches, count: matches.length }
      },
    },

    // ─────────────── WRITE (8) ───────────────
    {
      name: 'log_weight',
      description: 'Log a weight for an animal. Give the nickname (resolver) or the id. Returns the audit id so the operator can confirm "logged at hh:mm".',
      inputSchema: {
        type: 'object',
        properties: {
          animal_nickname: { type: 'string', description: 'The animal\'s nickname (e.g. "Buzz"). Resolver looks it up server-side.' },
          animal_id: { type: 'string', description: 'The animal uuid (used when nickname is ambiguous).' },
          kg: { type: 'number', description: 'Weight in kilograms (decimal).' },
          keeper: { type: 'string', description: 'Keeper display name — recorded in the action payload notes.' },
          notes: { type: 'string', description: 'Optional free-text note.' },
        },
        required: ['kg'],
      },
      status: 'live',
      handler: async (client, args) => {
        let animalId = args.animal_id as string | undefined
        let resolvedFromNickname: string | undefined
        if (!animalId && args.animal_nickname) {
          const resolved = await resolveAnimalId(client, String(args.animal_nickname))
          if (!resolved) {
            return {
              success: false,
              error: 'ambiguous_or_missing_animal',
              message: `Couldn\'t find exactly one animal with nickname "${args.animal_nickname}". Try search_animals_by_nickname first and pass animal_id.`,
            }
          }
          animalId = resolved.id
          resolvedFromNickname = resolved.nickname
        }
        if (!animalId) {
          return { success: false, error: 'missing_target', message: 'Provide animal_nickname or animal_id.' }
        }
        if (typeof args.kg !== 'number') {
          return { success: false, error: 'invalid_input', message: 'kg must be a number (e.g. 1.2).' }
        }
        const notesParts = [args.keeper && `keeper: ${args.keeper}`, args.notes].filter(Boolean)
        const notes = notesParts.length ? notesParts.join(' · ') : undefined
        const resp = await client.post<{ action_id: string; logged_at: string }>('/actions/weight', {
          animal_id: animalId,
          kg: args.kg,
          ...(notes ? { notes } : {}),
        })
        return {
          success: true,
          audit_id: resp.action_id,
          logged_at: resp.logged_at,
          human_summary: `Logged ${args.kg} kg on ${resolvedFromNickname ?? 'animal'} at ${new Date(resp.logged_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`,
        }
      },
    },
    {
      name: 'log_feed',
      description: 'Log a feeding. Target can be an animal or an enclosure. Returns audit id + human summary.',
      inputSchema: {
        type: 'object',
        properties: {
          target_table: { type: 'string', enum: ['animals', 'enclosures'], description: 'Which entity was fed.' },
          target_id: { type: 'string', description: 'Uuid of the animal or enclosure.' },
          animal_nickname: { type: 'string', description: 'Alternative to target_id — resolver maps nickname to animal_id.' },
          food: { type: 'string', description: 'What was fed (e.g. "day-old chicks").' },
          amount: { type: 'string', description: 'How much (free text, e.g. "2").' },
          keeper: { type: 'string', description: 'Keeper display name.' },
          notes: { type: 'string', description: 'Optional free-text note.' },
        },
      },
      status: 'live',
      handler: async (client, args) => {
        let targetTable = args.target_table as string | undefined
        let targetId = args.target_id as string | undefined
        if (!targetId && args.animal_nickname) {
          const resolved = await resolveAnimalId(client, String(args.animal_nickname))
          if (!resolved) {
            return {
              success: false,
              error: 'ambiguous_or_missing_animal',
              message: `Couldn\'t find exactly one animal with nickname "${args.animal_nickname}".`,
            }
          }
          targetTable = 'animals'
          targetId = resolved.id
        }
        if (!targetTable || !targetId) {
          return { success: false, error: 'missing_target', message: 'Provide (target_table + target_id) OR animal_nickname.' }
        }
        const resp = await client.post<{ action_id: string; logged_at: string }>('/actions/feed', {
          target_table: targetTable,
          target_id: targetId,
          food: args.food,
          amount: args.amount,
          notes: [args.keeper && `keeper: ${args.keeper}`, args.notes].filter(Boolean).join(' · ') || undefined,
        })
        return {
          success: true,
          audit_id: resp.action_id,
          logged_at: resp.logged_at,
          human_summary: `Logged feed on ${targetTable}/${String(targetId).slice(0, 8)} at ${new Date(resp.logged_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`,
        }
      },
    },
    {
      name: 'log_enrichment',
      description: 'Log an enrichment session for an animal. (Pending — ships in Week 4 actions widen.)',
      inputSchema: {
        type: 'object',
        properties: {
          animal_nickname: { type: 'string' },
          animal_id: { type: 'string' },
          session_type: { type: 'string', description: 'E.g. "scent", "puzzle-feeder", "flight-training".' },
          duration_min: { type: 'integer' },
          notes: { type: 'string' },
        },
      },
      status: 'pending',
      handler: pending('log_enrichment', 'in Week 4', 'POST /v1/actions/enrichment'),
    },
    {
      name: 'log_vet_note',
      description: 'Log a vet note for an animal. (Pending — ships in Week 4 actions widen.)',
      inputSchema: {
        type: 'object',
        properties: {
          animal_nickname: { type: 'string' },
          animal_id: { type: 'string' },
          vet_name: { type: 'string' },
          body: { type: 'string' },
        },
      },
      status: 'pending',
      handler: pending('log_vet_note', 'in Week 4', 'POST /v1/actions/vet-note'),
    },
    {
      name: 'mark_check_done',
      description: 'Mark a scheduled check as completed. (Pending — ships in Week 4 checks gateway.)',
      inputSchema: {
        type: 'object',
        properties: {
          check_id: { type: 'string' },
          result_summary: { type: 'string' },
          keeper: { type: 'string' },
        },
      },
      status: 'pending',
      handler: pending('mark_check_done', 'in Week 4', 'POST /v1/actions/check-done'),
    },
    {
      name: 'raise_incident',
      description: 'Raise an incident against an animal, enclosure, or the site. (Pending — ships in Week 4 incidents gateway.)',
      inputSchema: {
        type: 'object',
        properties: {
          target_kind: { type: 'string', enum: ['animal', 'enclosure', 'site'] },
          target_name_or_id: { type: 'string' },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          summary: { type: 'string' },
        },
      },
      status: 'pending',
      handler: pending('raise_incident', 'in Week 4', 'POST /v1/incidents'),
    },
    {
      name: 'add_note_to_animal',
      description: 'Add a free-text note attached to an animal\'s record. (Pending — ships in Week 4 notes gateway.)',
      inputSchema: {
        type: 'object',
        properties: {
          animal_nickname: { type: 'string' },
          animal_id: { type: 'string' },
          body: { type: 'string' },
        },
      },
      status: 'pending',
      handler: pending('add_note_to_animal', 'in Week 4', 'POST /v1/animals/{id}/notes'),
    },
    {
      name: 'move_animal_to_enclosure',
      description: 'Move an animal to a different enclosure. (Pending — ships in Week 4 animals gateway widen.)',
      inputSchema: {
        type: 'object',
        properties: {
          animal_nickname_or_id: { type: 'string' },
          enclosure_name_or_id: { type: 'string' },
        },
      },
      status: 'pending',
      handler: pending('move_animal_to_enclosure', 'in Week 4', 'PATCH /v1/animals/{id}'),
    },
  ]
}
