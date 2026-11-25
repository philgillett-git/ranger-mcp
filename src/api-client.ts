/**
 * Thin fetch wrapper for the Ranger public API.
 *
 * WHY shared:
 * Every tool hits the same gateway with the same auth header. Centralising
 * the error-envelope parsing + 429 surfacing keeps each tool handler
 * focused on its own argument validation + response shaping.
 */
import type { RangerConfig } from './config'

export interface ApiError extends Error {
  code: string
  status: number
  details?: Record<string, unknown>
}

function makeError(code: string, message: string, status: number, details?: Record<string, unknown>): ApiError {
  const err = new Error(message) as ApiError
  err.code = code
  err.status = status
  if (details) err.details = details
  return err
}

export class RangerApiClient {
  constructor(private readonly cfg: RangerConfig) {}

  async request<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    opts: { query?: Record<string, string | number | boolean | undefined>; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(this.cfg.apiUrl + (path.startsWith('/') ? path : `/${path}`))
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v === undefined || v === null) continue
      url.searchParams.set(k, String(v))
    }

    const res = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    })

    const text = await res.text()
    let parsed: unknown = null
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text)
      } catch {
        if (!res.ok) throw makeError('invalid_response', `Non-JSON ${res.status} response: ${text.slice(0, 200)}`, res.status)
      }
    }

    if (!res.ok) {
      const envelope = (parsed ?? {}) as { error?: { code?: string; message?: string; last_minute?: number; last_day?: number } }
      const code = envelope.error?.code ?? `http_${res.status}`
      const message = envelope.error?.message ?? `HTTP ${res.status}`
      const extra: Record<string, unknown> = {}
      if (envelope.error?.last_minute !== undefined) extra.last_minute = envelope.error.last_minute
      if (envelope.error?.last_day !== undefined) extra.last_day = envelope.error.last_day
      throw makeError(code, message, res.status, Object.keys(extra).length ? extra : undefined)
    }

    return (parsed ?? {}) as T
  }

  get<T = unknown>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('GET', path, { query })
  }

  post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, { body })
  }
}
