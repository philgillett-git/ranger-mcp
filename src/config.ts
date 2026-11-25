/**
 * Config loader — reads RANGER_API_KEY (required) + RANGER_API_URL (optional)
 * from env. Throws with a helpful message if the key is missing.
 *
 * WHY throw on missing key (not silently proceed with reads only):
 * MCP clients spawn this process over stdio; they surface stderr to the
 * user. A clear "set RANGER_API_KEY" tells the operator exactly what to
 * do; a silent failure makes every tool call 401 and they don't know why.
 */

export interface RangerConfig {
  apiKey: string
  apiUrl: string
}

export function loadConfig(): RangerConfig {
  const apiKey = process.env.RANGER_API_KEY ?? ''
  const apiUrl = (process.env.RANGER_API_URL ?? 'https://station.rangerwild.com/api/v1').replace(/\/$/, '')

  if (!apiKey) {
    throw new Error(
      [
        'RANGER_API_KEY is required.',
        '',
        'Create a key at https://station.rangerwild.com/settings/api-keys, then add it to your',
        'MCP client config. Example for Claude Desktop:',
        '',
        '  {',
        '    "mcpServers": {',
        '      "ranger": {',
        '        "command": "npx",',
        '        "args": ["-y", "@rangerwild/mcp-server"],',
        '        "env": { "RANGER_API_KEY": "rwk_live_..." }',
        '      }',
        '    }',
        '  }',
      ].join('\n'),
    )
  }

  if (!apiKey.startsWith('rwk_live_') && !apiKey.startsWith('rwk_test_')) {
    throw new Error('RANGER_API_KEY must start with rwk_live_ or rwk_test_')
  }

  return { apiKey, apiUrl }
}
