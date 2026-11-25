# @rangerwild/mcp-server

> Give Claude Desktop (or Cursor, or any MCP client) direct access to your Ranger Wild centre.

An industry-first for zoo + wildlife software: install one package, paste your API key, and type *"log weight 1.2 kg for Buzz"* in Claude Desktop — Ranger Station records it with full Rule 10 audit, under your operator identity.

20 tools exposed over the [Model Context Protocol](https://modelcontextprotocol.io), spanning read (list animals, species, dashboard summary, search by nickname, etc.) and write (log weight, log feed, raise incident, mark check done, etc.). 7 are live in Week 2; the rest widen progressively through Week 4 of the API-first pivot.

---

## Install (Claude Desktop)

1. **Create an API key** at [station.rangerwild.com/settings/api-keys](https://station.rangerwild.com/settings/api-keys). Copy it — you won't see it again.
2. **Open Claude Desktop → Settings → Developer → Edit Config** (this opens `claude_desktop_config.json`).
3. **Add this to `mcpServers`:**

   ```json
   {
     "mcpServers": {
       "ranger": {
         "command": "npx",
         "args": ["-y", "@rangerwild/mcp-server"],
         "env": {
           "RANGER_API_KEY": "rwk_live_..."
         }
       }
     }
   }
   ```

4. **Restart Claude Desktop.** Look for the 🔌 icon at the bottom of the chat input — "ranger" should be in the list with 20 tools.
5. Try: *"How many animals at my centre? Then log a weight of 1.2 kg for Buzz, keeper phil."*

---

## Install (Cursor)

Cursor's MCP config is per-workspace under `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "ranger": {
      "command": "npx",
      "args": ["-y", "@rangerwild/mcp-server"],
      "env": { "RANGER_API_KEY": "rwk_live_..." }
    }
  }
}
```

---

## Install (ChatGPT custom tool via MCP bridge)

ChatGPT supports MCP via a bridge. The exact snippet depends on the bridge you use; the env + command are the same as above. See the ChatGPT docs for the current MCP-tool install path.

---

## Available tools (20)

### Read (12)

| Tool | What it does | Status |
|------|--------------|--------|
| `list_animals` | List up to 500 animals at your centre | **live** |
| `get_animal` | Fetch one animal by uuid | **live** |
| `list_species` | List species held at your centre | **live** |
| `get_species` | Fetch one species-at-this-centre record | **live** |
| `list_enclosures` | List enclosures | pending (Week 4) |
| `get_enclosure` | One enclosure + contents | pending (Week 4) |
| `list_overdue_checks` | All checks past their next-due date | pending (Week 4) |
| `list_recent_incidents` | Incidents in the last N days | pending (Week 4) |
| `get_dashboard_summary` | Headline counts for your centre | **live** |
| `list_upcoming_events` | Events in the next N days | pending (Week 4) |
| `list_api_activity_today` | What has Claude Desktop done today | pending (Week 4) |
| `search_animals_by_nickname` | Find animals by nickname fragment | **live** |

### Write (8)

| Tool | What it does | Status |
|------|--------------|--------|
| `log_weight` | Record a weight for an animal | **live** |
| `log_feed` | Record a feeding for an animal or enclosure | **live** |
| `log_enrichment` | Record an enrichment session | pending (Week 4) |
| `log_vet_note` | Record a vet note | pending (Week 4) |
| `mark_check_done` | Mark a scheduled check completed | pending (Week 4) |
| `raise_incident` | Raise an incident | pending (Week 4) |
| `add_note_to_animal` | Attach a free-text note to an animal | pending (Week 4) |
| `move_animal_to_enclosure` | Move an animal between enclosures | pending (Week 4) |

Every write tool returns `{ success, audit_id, logged_at, human_summary }` so Claude Desktop can confirm the action with its audit id.

---

## Why MCP

Ranger Wild is positioned as the first AI-native platform for zoo and wildlife centre operations. That doesn't mean "there's a chat window on the dashboard" — it means every capability is an API, so operators can drive Ranger from whatever tool they already live in. MCP is the protocol that makes that real: one install, every AI client gets Ranger as a tool.

See [developers.rangerwild.com](https://developers.rangerwild.com) (launches Week 4) for the full spec, a Scalar-rendered browser, and change log.

---

## Local dev + publish

```bash
cd apps/ranger-mcp
npm install
npm run build        # compile src/ → dist/
node dist/index.js --list-tools   # quick catalogue check (no API key needed)
RANGER_API_KEY=rwk_live_... node scripts/smoke-mcp.mjs   # end-to-end smoke
```

Publish (Phil-triggered):

```bash
cd apps/ranger-mcp
npm publish         # publishConfig.access = public is set
```

---

## Env vars

| Name | Required | Default |
|------|----------|---------|
| `RANGER_API_KEY` | yes | — |
| `RANGER_API_URL` | no | `https://station.rangerwild.com/api/v1` |

Set `RANGER_API_URL` to a staging gateway (e.g. a preview deploy) if you need to point this server at a non-production API.

---

## Protocol + SDK

- Transport: stdio (JSON-RPC 2.0)
- SDK: [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
- Spec: [modelcontextprotocol.io](https://modelcontextprotocol.io)

Hosted MCP (SSE transport) is a separate entry point not shipped in this version.

---

## Licence + support

MIT © Ranger Wild Ltd — see [LICENSE](./LICENSE). Use of the Ranger Wild API itself is additionally governed by the Terms you accept when creating an API key at station.rangerwild.com. Issues → [github.com/philgillett-git/ranger-mcp/issues](https://github.com/philgillett-git/ranger-mcp/issues).
