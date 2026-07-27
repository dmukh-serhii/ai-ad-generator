import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'

export const Route = createFileRoute('/admin_/login')({ component: LoginPage })

function LoginPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) {
        setError(data.error ?? `login failed (${res.status})`)
        return
      }
      void navigate({ to: '/admin' })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="demo-page demo-center">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <img
            src="/logo.svg"
            alt="Snaprime logo"
            className="mx-auto mb-3 h-12 w-12"
          />
          <p className="island-kicker mb-2">Snaprime</p>
          <h1 className="display-title demo-title text-3xl!">Admin sign in</h1>
        </div>
        <form onSubmit={onSubmit} className="demo-panel space-y-3">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            autoComplete="username"
            required
            className="demo-input"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            required
            className="demo-input"
          />
          <button type="submit" disabled={loading} className="demo-button w-full">
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
          {error && (
            <p className="demo-alert demo-alert-danger text-sm">{error}</p>
          )}
        </form>
      </div>
    </main>
  )
}
