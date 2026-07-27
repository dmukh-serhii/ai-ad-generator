import { getAuthUser } from '#/lib/auth'
import { countRecentByIp } from '#/lib/usage'
import type { AuthUser } from '#/lib/auth'

// Configured via wrangler.jsonc `vars` (or .dev.vars locally); the values
// here are only fallbacks when the env vars are missing or malformed.
const DEFAULT_PUBLIC_USER_ID = 'u-test-0001'
const DEFAULT_LIMIT_PER_HOUR = 12
const WINDOW_MINUTES = 60

/**
 * Identity recorded for anonymous visitors — defaults to the seeded "test"
 * account, so public traffic shows up in the existing admin usage table
 * alongside real users without any schema change.
 */
export function publicUserId(): string {
  return process.env.PUBLIC_USER_ID?.trim() || DEFAULT_PUBLIC_USER_ID
}

/** Generator API calls allowed per IP per hour (~3 calls per full run). */
export function publicLimitPerHour(): number {
  const n = Number(process.env.PUBLIC_LIMIT_PER_HOUR)
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_LIMIT_PER_HOUR
}

export interface Requester {
  /** Present only for logged-in (admin-managed) accounts. */
  user: AuthUser | null
  /** Identity to record in usage_events. */
  userId: string
  ip: string
  authed: boolean
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'local'
  )
}

/**
 * Who is calling: a logged-in account if a valid session cookie is present,
 * otherwise the anonymous public identity. Never rejects the request.
 */
export async function resolveRequester(request: Request): Promise<Requester> {
  const ip = getClientIp(request)
  const auth = await getAuthUser(request)
  if (auth.ok) {
    return { user: auth.user, userId: auth.user.id, ip, authed: true }
  }
  return { user: null, userId: publicUserId(), ip, authed: false }
}

/** Logged-in accounts bypass the per-IP limit (they are admin-managed). */
export async function isRateLimited(req: Requester): Promise<boolean> {
  if (req.authed) return false
  return (await countRecentByIp(req.ip, WINDOW_MINUTES)) >= publicLimitPerHour()
}
