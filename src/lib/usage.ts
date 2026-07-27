import { env } from 'cloudflare:workers'

export type UsageAction =
  | 'extract'
  | 'brand_profile'
  | 'generate_ads'
  | 'regenerate_ad'

/**
 * Outcome of a logged request:
 *  - rate_limited: our per-IP limit blocked the call (no Gemini involved)
 *  - gemini_error: the Gemini API itself failed (quota, timeout, bad key)
 *  - error: any other failure (bad input, unreadable page, ...)
 */
export type UsageOutcome = 'success' | 'rate_limited' | 'gemini_error' | 'error'

export interface LogUsageOpts {
  url?: string | null
  ip?: string | null
  outcome?: UsageOutcome
}

/** Best-effort usage logging — never breaks the request it decorates. */
export async function logUsage(
  userId: string,
  action: UsageAction,
  opts: LogUsageOpts = {},
): Promise<void> {
  try {
    await env.DB.prepare(
      'INSERT INTO usage_events (user_id, action, url, ip, outcome) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(
        userId,
        action,
        opts.url ?? null,
        opts.ip ?? null,
        opts.outcome ?? 'success',
      )
      .run()
  } catch (e) {
    console.log(`[usage] failed to log ${action}: ${(e as Error).message}`)
  }
}

/**
 * How many non-rate-limited requests this IP made inside the window.
 * Rate-limited attempts are excluded so hammering the endpoint while
 * blocked does not extend the block forever.
 */
export async function countRecentByIp(
  ip: string,
  windowMinutes: number,
): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) as n FROM usage_events
     WHERE ip = ? AND outcome != 'rate_limited'
       AND created_at > datetime('now', ?)`,
  )
    .bind(ip, `-${windowMinutes} minutes`)
    .first<{ n: number }>()
  return row?.n ?? 0
}

export interface UsageEvent {
  id: number
  user_id: string
  username: string | null
  action: UsageAction
  url: string | null
  ip: string | null
  outcome: UsageOutcome
  created_at: string
}

/** Most recent events for the admin traffic log, newest first. */
export async function recentEvents(limit = 200): Promise<Array<UsageEvent>> {
  const rows = await env.DB.prepare(
    `SELECT e.id, e.user_id, u.username, e.action, e.url, e.ip, e.outcome, e.created_at
     FROM usage_events e LEFT JOIN users u ON u.id = e.user_id
     ORDER BY e.id DESC LIMIT ?`,
  )
    .bind(limit)
    .all<UsageEvent>()
  return rows.results
}

export interface UserUsage {
  extract: number
  brand_profile: number
  generate_ads: number
  urls: Array<{ url: string; count: number; last_used: string }>
}

const MAX_URLS_PER_USER = 20

/** Aggregate usage for the admin table, keyed by user id. */
export async function usageByUser(): Promise<Record<string, UserUsage>> {
  const [counts, urls] = await Promise.all([
    env.DB.prepare(
      'SELECT user_id, action, COUNT(*) as n FROM usage_events GROUP BY user_id, action',
    ).all<{ user_id: string; action: UsageAction; n: number }>(),
    env.DB.prepare(
      `SELECT user_id, url, COUNT(*) as n, MAX(created_at) as last_used
       FROM usage_events WHERE action = 'extract' AND url IS NOT NULL
       GROUP BY user_id, url ORDER BY last_used DESC LIMIT 500`,
    ).all<{ user_id: string; url: string; n: number; last_used: string }>(),
  ])

  const out: Record<string, UserUsage> = {}
  const forUser = (id: string): UserUsage =>
    (out[id] ??= { extract: 0, brand_profile: 0, generate_ads: 0, urls: [] })

  for (const row of counts.results) {
    const usage = forUser(row.user_id)
    if (
      row.action === 'extract' ||
      row.action === 'brand_profile' ||
      row.action === 'generate_ads'
    ) {
      usage[row.action] = row.n
    }
  }
  for (const row of urls.results) {
    const usage = forUser(row.user_id)
    if (usage.urls.length < MAX_URLS_PER_USER) {
      usage.urls.push({ url: row.url, count: row.n, last_used: row.last_used })
    }
  }
  return out
}
