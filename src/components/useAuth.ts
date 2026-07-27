import { useEffect, useState } from 'react'

export interface MeUser {
  id: string
  username: string
  role: 'admin' | 'user'
  blacklisted: boolean
  gemini_key_set: boolean
  gemini_key_hint: string | null
  created_at: string
  updated_at: string
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'anon' }
  | { status: 'limited'; message: string }
  | { status: 'authed'; user: MeUser }

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ status: 'loading' })
  useEffect(() => {
    fetch('/api/me')
      .then(async (res) => {
        if (res.ok) {
          const d = (await res.json()) as { user: MeUser }
          setState({ status: 'authed', user: d.user })
        } else if (res.status === 403) {
          const d = (await res.json()) as { error?: string }
          setState({
            status: 'limited',
            message: d.error ?? 'Your account has reached its rate limits.',
          })
        } else {
          setState({ status: 'anon' })
        }
      })
      .catch(() => setState({ status: 'anon' }))
  }, [])
  return state
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' })
  window.location.href = '/admin/login'
}

/** Detect the "blacklisted/deleted mid-session" response from any API call. */
export async function isAccountLimited(res: Response): Promise<string | null> {
  if (res.status !== 403) return null
  try {
    const d = (await res.clone().json()) as { code?: string; error?: string }
    return d.code === 'account_limited'
      ? (d.error ?? 'Your account has reached its rate limits.')
      : null
  } catch {
    return null
  }
}
