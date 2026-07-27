import { useEffect, useState } from 'react'

interface UsageEvent {
  id: number
  user_id: string
  username: string | null
  action: string
  url: string | null
  ip: string | null
  outcome: 'success' | 'rate_limited' | 'gemini_error' | 'error'
  created_at: string
}

const OUTCOME_STYLE: Record<UsageEvent['outcome'], string> = {
  success: 'bg-emerald-100 text-emerald-800',
  rate_limited: 'bg-amber-100 text-amber-800',
  gemini_error: 'bg-red-100 text-red-800',
  error: 'bg-gray-200 text-gray-700',
}

/** Recent request log: who (IP / account) did what, and how it ended. */
export function AdminTraffic() {
  const [events, setEvents] = useState<Array<UsageEvent>>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/usage-log')
      .then(async (res) => {
        const data = (await res.json()) as {
          events?: Array<UsageEvent>
          error?: string
        }
        if (!res.ok) {
          setError(data.error ?? `failed to load traffic log (${res.status})`)
          return
        }
        setEvents(data.events ?? [])
      })
      .catch((e) => setError((e as Error).message))
  }, [])

  return (
    <section className="demo-panel">
      <h2 className="demo-section-title mb-2 text-lg">
        Traffic log{' '}
        <span className="demo-muted text-sm font-normal">
          (last {events.length} requests · outcome shows IP rate limits vs real
          Gemini failures)
        </span>
      </h2>
      {error && (
        <p className="demo-alert demo-alert-danger mb-3 text-sm">{error}</p>
      )}
      <div className="demo-table-shell max-h-96 overflow-auto">
        <table className="demo-table text-xs">
          <thead className="sticky top-0">
            <tr>
              <th>Time (UTC)</th>
              <th>IP</th>
              <th>User</th>
              <th>Action</th>
              <th>URL</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr>
                <td colSpan={6} className="demo-muted text-center">
                  No requests logged yet.
                </td>
              </tr>
            )}
            {events.map((e) => (
              <tr key={e.id} className="align-top">
                <td className="demo-muted whitespace-nowrap">{e.created_at}</td>
                <td className="whitespace-nowrap font-mono">{e.ip ?? '–'}</td>
                <td className="whitespace-nowrap">{e.username ?? e.user_id}</td>
                <td className="whitespace-nowrap">{e.action}</td>
                <td className="max-w-64 truncate">{e.url ?? '–'}</td>
                <td className="whitespace-nowrap">
                  <span
                    className={`rounded-full px-2 py-0.5 font-semibold ${OUTCOME_STYLE[e.outcome] ?? OUTCOME_STYLE.error}`}
                  >
                    {e.outcome}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
