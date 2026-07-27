import { useEffect, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { logout, useAuth } from '#/components/useAuth'
import { AdminUsers } from '#/components/AdminUsers'
import { AdminTraffic } from '#/components/AdminTraffic'
import type { MeUser } from '#/components/useAuth'

export const Route = createFileRoute('/admin')({ component: AdminHome })

function AdminHome() {
  const auth = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (auth.status === 'anon') void navigate({ to: '/admin/login' })
  }, [auth.status, navigate])

  if (auth.status === 'loading' || auth.status === 'anon') {
    return <main className="demo-page demo-muted text-sm">Checking access…</main>
  }

  if (auth.status === 'limited') {
    return (
      <main className="demo-page demo-center">
        <div className="demo-panel max-w-md text-center">
          <h1 className="demo-section-title mb-2 text-lg">Access limited</h1>
          <p className="demo-muted text-sm">{auth.message}</p>
          <Link to="/admin/login" className="demo-button mt-4">
            Back to login
          </Link>
        </div>
      </main>
    )
  }

  const user = auth.user
  return (
    <main className="demo-page demo-page-wide">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <img src="/logo.svg" alt="Snaprime logo" className="h-11 w-11" />
          <div>
            <p className="island-kicker mb-1">Snaprime</p>
            <h1 className="display-title demo-title text-3xl!">Admin</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="demo-pill">
            {user.username} · {user.role}
          </span>
          <Link to="/" className="demo-button">
            Open generator
          </Link>
          <button
            type="button"
            onClick={() => void logout()}
            className="demo-button demo-button-secondary"
          >
            Log out
          </button>
        </div>
      </header>

      {user.role === 'admin' ? (
        <div className="space-y-8">
          <AdminUsers me={user} />
          <AdminTraffic />
        </div>
      ) : (
        <UserPanel me={user} />
      )}
    </main>
  )
}

function UserPanel({ me }: { me: MeUser }) {
  const [key, setKey] = useState('')
  const [hint, setHint] = useState(me.gemini_key_hint)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function saveKey(value: string | null) {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gemini_api_key: value }),
      })
      const data = (await res.json()) as {
        error?: string
        gemini_key_hint?: string | null
      }
      if (!res.ok) {
        setMessage(data.error ?? `save failed (${res.status})`)
        return
      }
      setHint(data.gemini_key_hint ?? null)
      setKey('')
      setMessage(value ? 'API key saved.' : 'API key cleared.')
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-4">
      <div className="demo-panel">
        <h2 className="demo-section-title mb-1 text-lg">
          Your Gemini API key
        </h2>
        <p className="demo-muted mb-3 text-sm">
          Generations use{' '}
          {hint ? (
            <>
              your key <code className="text-xs">{hint}</code>
            </>
          ) : (
            'the app default key'
          )}
          . Set your own free key from{' '}
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
          >
            aistudio.google.com/apikey
          </a>{' '}
          if you hit rate limits.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="AIza…"
            className="demo-input min-w-64 flex-1"
          />
          <button
            type="button"
            disabled={saving || !key.trim()}
            onClick={() => void saveKey(key.trim())}
            className="demo-button"
          >
            Save key
          </button>
          {hint && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveKey(null)}
              className="demo-button demo-button-secondary"
            >
              Clear
            </button>
          )}
        </div>
        {message && <p className="demo-muted mt-2 text-sm">{message}</p>}
      </div>

      <div className="demo-panel text-sm">
        <h2 className="demo-section-title mb-1 text-lg">How it works</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Open the <Link to="/">generator</Link> and paste any site URL.
          </li>
          <li>Review the extracted site info, then generate a brand profile.</li>
          <li>Generate ad variants — edit them inline, swap images, regenerate.</li>
        </ol>
      </div>
    </section>
  )
}
