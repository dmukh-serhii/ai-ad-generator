import { env } from 'cloudflare:workers'

export interface AuthUser {
  id: string
  username: string
  role: 'admin' | 'user'
  gemini_api_key: string | null
  blacklisted: number
  created_at: string
  updated_at: string
}

const COOKIE_NAME = 'snaprime_session'
const SESSION_TTL_S = 7 * 24 * 3600
const PBKDF2_ITERATIONS = 100_000

/** Shown to blacklisted/deleted accounts instead of revealing the ban. */
export const ACCOUNT_LIMITED_MESSAGE =
  'Your account has reached its rate limits. Please contact the administrator.'

export function randomHex(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes))
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2))
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

export async function hashPassword(
  password: string,
  saltHex: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: hexToBytes(saltHex),
      iterations: PBKDF2_ITERATIONS,
    },
    key,
    256,
  )
  return [...new Uint8Array(bits)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function sessionCookie(
  token: string,
  maxAgeSeconds: number,
  secure: boolean,
): string {
  // Secure only over https — local dev runs on plain http://localhost.
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Lax; Max-Age=${maxAgeSeconds}`
}

export function clearSessionCookie(): string {
  return sessionCookie('', 0, false)
}

export async function createSession(
  userId: string,
  request: Request,
): Promise<{ token: string; cookie: string }> {
  const token = randomHex(32)
  const expiresAt = new Date(Date.now() + SESSION_TTL_S * 1000).toISOString()
  await env.DB.prepare(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)',
  )
    .bind(token, userId, expiresAt)
    .run()
  const secure = new URL(request.url).protocol === 'https:'
  return { token, cookie: sessionCookie(token, SESSION_TTL_S, secure) }
}

export async function destroySession(token: string): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run()
}

function readSessionToken(request: Request): string | null {
  const cookies = request.headers.get('cookie') ?? ''
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`))
  return match ? match[1] : null
}

export type AuthResult =
  | { ok: true; user: AuthUser; token: string }
  | { ok: false; response: Response }

function deny(status: number, error: string, code: string): Response {
  return Response.json(
    { error, code },
    { status, headers: { 'set-cookie': clearSessionCookie() } },
  )
}

/**
 * Resolve the current user from the session cookie. Blacklisted or deleted
 * accounts get their session destroyed and a 403 "rate limited" response —
 * this runs on every API call, so a ban takes effect immediately.
 */
export async function getAuthUser(request: Request): Promise<AuthResult> {
  const token = readSessionToken(request)
  if (!token) {
    return { ok: false, response: deny(401, 'not authenticated', 'unauthenticated') }
  }

  const row = await env.DB.prepare(
    `SELECT s.expires_at as session_expires_at, u.*
     FROM sessions s LEFT JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`,
  )
    .bind(token)
    .first<AuthUser & { session_expires_at: string; id: string | null }>()

  if (!row || row.session_expires_at < new Date().toISOString()) {
    if (row) await destroySession(token)
    return { ok: false, response: deny(401, 'session expired', 'unauthenticated') }
  }

  if (row.id === null || row.blacklisted) {
    // Deleted or blacklisted: kill the session and report as "rate limited".
    await destroySession(token)
    return {
      ok: false,
      response: deny(403, ACCOUNT_LIMITED_MESSAGE, 'account_limited'),
    }
  }

  const { session_expires_at: _exp, ...user } = row
  return { ok: true, user: user as AuthUser, token }
}

export async function requireAdmin(request: Request): Promise<AuthResult> {
  const auth = await getAuthUser(request)
  if (!auth.ok) return auth
  if (auth.user.role !== 'admin') {
    return {
      ok: false,
      response: Response.json({ error: 'admin access required' }, { status: 403 }),
    }
  }
  return auth
}

export function publicUser(user: AuthUser) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    blacklisted: Boolean(user.blacklisted),
    gemini_key_set: Boolean(user.gemini_api_key),
    gemini_key_hint: user.gemini_api_key
      ? `…${user.gemini_api_key.slice(-4)}`
      : null,
    created_at: user.created_at,
    updated_at: user.updated_at,
  }
}

/** The Gemini key to use for this user: their own key, else the app default. */
export function geminiKeyFor(user: AuthUser): string | undefined {
  return user.gemini_api_key?.trim() || process.env.GEMINI_API_KEY?.trim()
}
