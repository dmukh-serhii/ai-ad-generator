import { Fragment, useEffect, useState } from 'react'
import type { MeUser } from '#/components/useAuth'

interface UserUsage {
  extract: number
  brand_profile: number
  generate_ads: number
  urls: Array<{ url: string; count: number; last_used: string }>
}

type AdminUser = MeUser & { usage: UserUsage }

export function AdminUsers({ me }: { me: MeUser }) {
  const [users, setUsers] = useState<Array<AdminUser>>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user')
  const [busy, setBusy] = useState(false)

  async function load() {
    const res = await fetch('/api/users')
    const data = (await res.json()) as { users?: Array<AdminUser>; error?: string }
    if (!res.ok) {
      setError(data.error ?? `failed to load users (${res.status})`)
      return
    }
    setUsers(data.users ?? [])
  }

  useEffect(() => {
    void load()
  }, [])

  async function api(
    path: string,
    method: string,
    body?: unknown,
  ): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(path, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        setError(data.error ?? `request failed (${res.status})`)
        return false
      }
      await load()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault()
    const ok = await api('/api/users', 'POST', {
      username: newUsername,
      password: newPassword,
      role: newRole,
    })
    if (ok) {
      setNewUsername('')
      setNewPassword('')
      setNewRole('user')
    }
  }

  function resetPassword(u: MeUser) {
    const pw = window.prompt(`New password for "${u.username}" (min 6 chars):`)
    if (pw) void api(`/api/users/${u.id}`, 'PATCH', { password: pw })
  }

  function rename(u: MeUser) {
    const name = window.prompt('New username:', u.username)
    if (name && name !== u.username) {
      void api(`/api/users/${u.id}`, 'PATCH', { username: name })
    }
  }

  function removeUser(u: MeUser) {
    if (window.confirm(`Delete user "${u.username}"? This cannot be undone.`)) {
      void api(`/api/users/${u.id}`, 'DELETE')
    }
  }

  const btn = 'demo-button demo-button-secondary px-2! py-1! text-xs!'

  return (
    <section className="demo-panel space-y-4">
      <h2 className="demo-section-title text-lg">Users</h2>

      {error && (
        <p className="demo-alert demo-alert-danger text-sm">{error}</p>
      )}

      <div className="demo-table-shell">
        <table className="demo-table text-sm">
          <thead>
            <tr className="text-xs uppercase">
              <th>Username</th>
              <th>Role</th>
              <th>Gemini key</th>
              <th>Status</th>
              <th title="extracts / brand profiles / ad generations">
                Usage (url/profile/ads)
              </th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <Fragment key={u.id}>
              <tr>
                <td className="font-medium">
                  {u.username}
                  {u.id === me.id && (
                    <span className="demo-muted ml-1 text-xs">(you)</span>
                  )}
                </td>
                <td>{u.role}</td>
                <td className="demo-muted text-xs">
                  {u.gemini_key_set ? `set (${u.gemini_key_hint})` : 'default'}
                </td>
                <td>
                  {u.blacklisted ? (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                      blacklisted
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                      active
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap text-xs">
                  <span title="Create from URL (extractions)">{u.usage.extract}</span>
                  {' / '}
                  <span title="Brand profiles generated">{u.usage.brand_profile}</span>
                  {' / '}
                  <span title="Ad generations">{u.usage.generate_ads}</span>
                  {u.usage.urls.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded(expanded === u.id ? null : u.id)
                      }
                      className="ml-2 cursor-pointer text-(--lagoon-deep) hover:underline"
                    >
                      {expanded === u.id ? 'hide urls' : `urls (${u.usage.urls.length})`}
                    </button>
                  )}
                </td>
                <td className="demo-muted text-xs">
                  {u.created_at.slice(0, 10)}
                </td>
                <td className="space-x-1 whitespace-nowrap">
                  <button className={btn} disabled={busy} onClick={() => rename(u)}>
                    Rename
                  </button>
                  <button
                    className={btn}
                    disabled={busy}
                    onClick={() => resetPassword(u)}
                  >
                    Password
                  </button>
                  {u.id !== me.id && (
                    <>
                      <button
                        className={btn}
                        disabled={busy}
                        onClick={() =>
                          void api(`/api/users/${u.id}`, 'PATCH', {
                            role: u.role === 'admin' ? 'user' : 'admin',
                          })
                        }
                      >
                        Make {u.role === 'admin' ? 'user' : 'admin'}
                      </button>
                      <button
                        className={btn}
                        disabled={busy}
                        onClick={() =>
                          void api(`/api/users/${u.id}`, 'PATCH', {
                            blacklisted: !u.blacklisted,
                          })
                        }
                      >
                        {u.blacklisted ? 'Restore' : 'Blacklist'}
                      </button>
                      <button
                        className={`${btn} demo-button-danger`}
                        disabled={busy}
                        onClick={() => removeUser(u)}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </td>
              </tr>
              {expanded === u.id && (
                <tr>
                  <td colSpan={7}>
                    <p className="demo-muted mb-1 text-xs font-semibold">
                      URLs used in the generator (× times · last used):
                    </p>
                    <ul className="max-h-48 space-y-0.5 overflow-auto text-xs">
                      {u.usage.urls.map((entry) => (
                        <li key={entry.url} className="truncate">
                          <a
                            href={entry.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {entry.url}
                          </a>
                          <span className="demo-muted">
                            {' '}
                            — ×{entry.count} · {entry.last_used.slice(0, 16).replace('T', ' ')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <form
        onSubmit={createUser}
        className="flex flex-wrap items-center gap-2"
      >
        <span className="demo-section-title text-sm">New user:</span>
        <input
          value={newUsername}
          onChange={(e) => setNewUsername(e.target.value)}
          placeholder="username"
          required
          className="demo-input demo-input-fit text-sm"
        />
        <input
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="password"
          type="text"
          required
          minLength={6}
          className="demo-input demo-input-fit text-sm"
        />
        <select
          value={newRole}
          onChange={(e) => setNewRole(e.target.value as 'user' | 'admin')}
          className="demo-select text-sm"
          style={{ width: 'auto' }}
        >
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
        <button type="submit" disabled={busy} className="demo-button">
          Create
        </button>
      </form>
    </section>
  )
}
