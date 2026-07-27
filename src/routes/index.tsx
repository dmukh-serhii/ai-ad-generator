import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import type { Extraction } from '#/lib/extract'
import type { BrandProfile, BrandProfileResult } from '#/lib/brandProfile'
import type { StoredAd } from '#/lib/adStore'
import { AdCard } from '#/components/AdCard'

interface GenerateAdsResponse {
  ads: Array<StoredAd>
  error: string | null
  model: string
  latencyMs: number
  usage: { promptTokens: number; outputTokens: number } | null
  costUsd: number | null
}

/** Served instead of an error when rate-limited or Gemini is unavailable. */
interface DemoResponse {
  demo: true
  reason: 'rate_limited' | 'gemini_unavailable'
  message: string
  sample: {
    sourceUrl: string
    extraction: {
      url: string
      finalUrl: string
      title: string | null
      text: string
      textTotalChars: number
      meta: Array<{ name: string; content: string }>
      images: Array<{ src: string; alt: string | null }>
    }
    profile: BrandProfile
    ads: Array<{
      concept: string
      primary_text: string
      headline: string
      description: string
      cta: string
      image_url: string | null
    }>
  }
}

export function formatCost(costUsd: number | null): string {
  return costUsd === null ? 'n/a' : `$${costUsd.toFixed(5)}`
}

export const Route = createFileRoute('/')({ component: GeneratorPage })

interface AiCall {
  label: string
  model: string | null
  ms: number
  cost: number | null
  tokens: string | null
}

interface ExtractResponse extends Extraction {
  url: string
  finalUrl: string
  warnings: Array<string>
  debug: {
    path: 'plain-fetch' | 'headless'
    reason: string
    plainTextChars: number | null
    fetchMs: number | null
    renderMs: number | null
    plainFetchError: string | null
    headlessError: string | null
  }
}

function GeneratorPage() {
  const [tab, setTab] = useState<'brand' | 'info'>('brand')
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ExtractResponse | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profile, setProfile] = useState<BrandProfileResult | null>(null)
  const [adsLoading, setAdsLoading] = useState(false)
  const [adsResult, setAdsResult] = useState<GenerateAdsResponse | null>(null)
  const [demo, setDemo] = useState<DemoResponse | null>(null)
  const [aiCalls, setAiCalls] = useState<Array<AiCall>>([])

  function addAiCall(call: AiCall) {
    setAiCalls((s) => [...s, call])
  }

  /** AdCard regenerations report only latency + cost. */
  function addAiUsage(ms: number, costUsd: number | null) {
    addAiCall({ label: 'Ad regenerated', model: null, ms, cost: costUsd, tokens: null })
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim() || loading) return
    setLoading(true)
    setError(null)
    setResult(null)
    setProfile(null)
    setAdsResult(null)
    setDemo(null)
    setAiCalls([])
    setTab('brand')
    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      const data = (await res.json()) as (ExtractResponse | DemoResponse) & {
        error?: string
      }
      if ('demo' in data && data.demo) {
        setDemo(data)
        return
      }
      if (!res.ok) {
        setError(data.error ?? `request failed with ${res.status}`)
        return
      }
      setResult(data as ExtractResponse)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function onGenerateProfile() {
    if (!result || profileLoading) return
    setProfileLoading(true)
    setProfile(null)
    setAdsResult(null)
    try {
      const res = await fetch('/api/brand-profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: result.text,
          images: result.images,
          url: result.finalUrl,
        }),
      })
      const data = (await res.json()) as (BrandProfileResult | DemoResponse) & {
        error?: string
      }
      if ('demo' in data && data.demo) {
        setDemo(data)
        return
      }
      if (!res.ok) {
        setError(data.error ?? `brand profile request failed with ${res.status}`)
        return
      }
      const profileData = data as BrandProfileResult
      setProfile(profileData)
      addAiCall({
        label: 'Brand profile',
        model: profileData.model,
        ms: profileData.latencyMs,
        cost: profileData.costUsd,
        tokens: profileData.usage
          ? `${profileData.usage.promptTokens} in / ${profileData.usage.outputTokens} out`
          : null,
      })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setProfileLoading(false)
    }
  }

  async function onGenerateAds() {
    if (!profile || !result || adsLoading) return
    setAdsLoading(true)
    setAdsResult(null)
    try {
      const res = await fetch('/api/generate-ads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profile: profile.profile,
          url: result.finalUrl,
        }),
      })
      const data = (await res.json()) as GenerateAdsResponse | DemoResponse
      if ('demo' in data && data.demo) {
        setDemo(data)
        return
      }
      const adsData = data as GenerateAdsResponse
      if (!res.ok) {
        setError(adsData.error ?? `ad generation failed with ${res.status}`)
        return
      }
      setAdsResult(adsData)
      addAiCall({
        label: `Ad variants (${adsData.ads.length})`,
        model: adsData.model,
        ms: adsData.latencyMs,
        cost: adsData.costUsd,
        tokens: adsData.usage
          ? `${adsData.usage.promptTokens} in / ${adsData.usage.outputTokens} out`
          : null,
      })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setAdsLoading(false)
    }
  }

  const stepClass = (done: boolean, active: boolean) =>
    `flow-step${done ? ' is-done' : ''}${active ? ' is-active' : ''}`

  return (
    <main className="demo-page">
      <div className="mx-auto max-w-3xl">
        <header className="rise-in mb-10 text-center">
          <img
            src="/logo.svg"
            alt="Snaprime logo"
            className="mx-auto mb-4 h-14 w-14 drop-shadow-md"
          />
          <p className="island-kicker mb-3">Snaprime · AI ad generator</p>
          <h1 className="display-title demo-title">
            Turn any website into ready-to-run ads
          </h1>
          <p className="demo-muted mx-auto mt-3 max-w-xl text-sm sm:text-base">
            Paste a URL. Snaprime reads the page, builds a brand profile and
            writes on-brand ad variants you can edit in place.
          </p>
        </header>

        <section className="demo-panel rise-in mb-6">
          <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
            <input
              type="url"
              required
              placeholder="https://yourbrand.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="demo-input flex-1"
            />
            <button type="submit" disabled={loading} className="demo-button sm:px-7">
              {loading ? 'Reading the site…' : 'Generate ads'}
            </button>
          </form>

          <div className="flow-steps mt-4">
            <span className={stepClass(!!result || !!demo, loading)}>
              <span className="flow-num">{result || demo ? '✓' : '1'}</span>
              Extract site
            </span>
            <span
              className={stepClass(
                !!profile || !!demo,
                !!result && !profile && !demo,
              )}
            >
              <span className="flow-num">{profile || demo ? '✓' : '2'}</span>
              Brand profile
            </span>
            <span
              className={stepClass(
                !!adsResult || !!demo,
                !!profile && !adsResult && !demo,
              )}
            >
              <span className="flow-num">{adsResult || demo ? '✓' : '3'}</span>
              Ad variants
            </span>
          </div>
        </section>

        {error && (
          <div className="demo-alert demo-alert-danger mb-6 text-sm">{error}</div>
        )}

        {demo && <DemoResult demo={demo} />}

        {!demo && result && (
          <div className="space-y-6">
            {result.warnings.length > 0 && (
              <section className="demo-alert text-sm">
                <h2 className="mb-1 font-bold">
                  {result.text
                    ? 'Partial result — some things could not be extracted'
                    : 'This page could not be read'}
                </h2>
                <ul className="list-disc space-y-1 pl-5">
                  {result.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </section>
            )}

            <nav className="flex gap-2">
              <button
                type="button"
                className={
                  tab === 'brand' ? 'demo-button' : 'demo-button demo-button-secondary'
                }
                onClick={() => setTab('brand')}
              >
                Brand profile & ads
              </button>
              <button
                type="button"
                className={
                  tab === 'info' ? 'demo-button' : 'demo-button demo-button-secondary'
                }
                onClick={() => setTab('info')}
              >
                Extraction details
              </button>
            </nav>

            {aiCalls.length > 0 && (
              <section className="demo-card text-xs">
                <p>
                  <strong>AI usage for this page:</strong> {aiCalls.length} call
                  {aiCalls.length > 1 ? 's' : ''} ·{' '}
                  {(aiCalls.reduce((s, c) => s + c.ms, 0) / 1000).toFixed(1)}s
                  total · est. cost{' '}
                  {formatCost(aiCalls.reduce((s, c) => s + (c.cost ?? 0), 0))}{' '}
                  <span className="demo-muted">
                    (list price — free tier: $0.00)
                  </span>
                </p>
                <ul className="demo-muted mt-1 space-y-0.5">
                  {aiCalls.map((c, i) => (
                    <li key={i}>
                      {c.label}
                      {c.model && ` — ${c.model}`} · {(c.ms / 1000).toFixed(1)}s
                      {c.tokens && ` · tokens: ${c.tokens}`} · est.{' '}
                      {formatCost(c.cost)}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {tab === 'brand' && (
              <>
                {!profile && (
                  <section className="demo-panel">
                    <h2 className="demo-section-title mb-1">
                      Step 2 — analyze the brand
                    </h2>
                    <p className="demo-muted mb-4 text-sm">
                      Snaprime turns the extracted page into a structured brand
                      profile: audience, value proposition, tone and colors.
                    </p>
                    <button
                      type="button"
                      onClick={onGenerateProfile}
                      disabled={profileLoading || !result.text}
                      title={
                        !result.text
                          ? 'No text was extracted from this page'
                          : undefined
                      }
                      className="demo-button"
                    >
                      {profileLoading
                        ? 'Analyzing with Gemini…'
                        : 'Generate brand profile'}
                    </button>
                    {!result.text && (
                      <p className="demo-muted mt-2 text-xs">
                        Disabled: no text content was extracted from this page.
                      </p>
                    )}
                  </section>
                )}

                {profile && (
                  <section className="demo-panel rise-in">
                    <p className="island-kicker mb-2">Brand profile</p>
                    {profile.error && (
                      <div className="demo-alert demo-alert-danger mb-3 text-sm">
                        LLM error (partial result): {profile.error}
                      </div>
                    )}
                    <BrandProfileFields profile={profile.profile} />
                    {profile.inputTruncated && (
                      <p className="demo-muted mt-4 text-xs">
                        Input text was truncated to 15k chars.
                      </p>
                    )}

                    {!profile.error && !adsResult && (
                      <button
                        type="button"
                        onClick={onGenerateAds}
                        disabled={adsLoading}
                        className="demo-button mt-4"
                      >
                        {adsLoading ? 'Writing ads…' : 'Generate ad variants →'}
                      </button>
                    )}
                  </section>
                )}

                {adsResult && (
                  <section className="rise-in space-y-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h2 className="demo-section-title text-lg">
                        Ad variants ({adsResult.ads.length})
                      </h2>
                      <p className="demo-muted text-xs">
                        Click any text to edit · hover the image to swap it ·
                        regenerate affects one ad only.
                      </p>
                    </div>
                    {adsResult.error && (
                      <div className="demo-alert demo-alert-danger text-sm">
                        {adsResult.error}
                      </div>
                    )}
                    {adsResult.ads.map((ad) => (
                      <AdCard
                        key={ad.id}
                        ad={ad}
                        candidates={profile?.profile.candidate_images ?? []}
                        onAiUsage={addAiUsage}
                      />
                    ))}
                  </section>
                )}
              </>
            )}

            {tab === 'info' && (
              <div className="space-y-4">
                <section className="demo-card text-sm">
                  <h2 className="demo-section-title mb-1">Extraction debug</h2>
                  <p>
                    Path:{' '}
                    <strong>
                      {result.debug.path === 'headless'
                        ? '🤖 headless (Browser Rendering)'
                        : '⚡ plain fetch'}
                    </strong>
                  </p>
                  <p className="demo-muted">{result.debug.reason}</p>
                  <p className="demo-muted">
                    fetch: {result.debug.fetchMs ?? '–'}ms
                    {result.debug.renderMs !== null && (
                      <> · render: {result.debug.renderMs}ms</>
                    )}
                    {result.debug.plainFetchError && (
                      <> · fetch error: {result.debug.plainFetchError}</>
                    )}
                    {result.debug.headlessError && (
                      <> · headless error: {result.debug.headlessError}</>
                    )}
                  </p>
                </section>

                <section className="demo-card">
                  <h2 className="demo-section-title">
                    {result.title ?? '(no title)'}
                  </h2>
                  <p className="demo-muted text-xs">{result.finalUrl}</p>
                </section>

                <section className="demo-card">
                  <h2 className="demo-section-title mb-2">
                    Meta tags ({result.meta.length})
                  </h2>
                  <div className="demo-table-shell max-h-64 overflow-auto">
                    <table className="demo-table text-xs">
                      <tbody>
                        {result.meta.map((m, i) => (
                          <tr key={i}>
                            <td className="whitespace-nowrap font-mono">
                              {m.name}
                            </td>
                            <td>{m.content}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="demo-card">
                  <h2 className="demo-section-title mb-2">
                    Images ({result.images.length})
                  </h2>
                  <ul className="max-h-64 space-y-1 overflow-auto text-xs">
                    {result.images.map((img, i) => (
                      <li key={i} className="truncate">
                        <a href={img.src} target="_blank" rel="noopener noreferrer">
                          {img.src}
                        </a>
                        {img.alt && (
                          <span className="demo-muted"> — alt: {img.alt}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="demo-card">
                  <h2 className="demo-section-title mb-2">
                    Text content ({result.text.length.toLocaleString()} chars)
                  </h2>
                  <pre className="demo-code-block max-h-96 overflow-auto whitespace-pre-wrap text-xs">
                    {result.text}
                  </pre>
                </section>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}

function BrandProfileFields({ profile }: { profile: BrandProfile }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      <div>
        <dt className="demo-section-title text-xs uppercase tracking-wide">
          What they do
        </dt>
        <dd className="mt-0.5">{profile.what_they_do}</dd>
      </div>
      <div>
        <dt className="demo-section-title text-xs uppercase tracking-wide">
          Target audience
        </dt>
        <dd className="mt-0.5">{profile.target_audience}</dd>
      </div>
      <div>
        <dt className="demo-section-title text-xs uppercase tracking-wide">
          Value proposition
        </dt>
        <dd className="mt-0.5">{profile.value_proposition}</dd>
      </div>
      <div>
        <dt className="demo-section-title text-xs uppercase tracking-wide">
          Brand tone
        </dt>
        <dd className="mt-0.5">{profile.brand_tone}</dd>
      </div>
      <div>
        <dt className="demo-section-title text-xs uppercase tracking-wide">
          Brand colors
        </dt>
        <dd className="mt-1 flex flex-wrap items-center gap-2">
          {profile.brand_colors.length === 0 && (
            <span className="demo-muted">not found</span>
          )}
          {profile.brand_colors.map((c, i) => (
            <span key={i} className="demo-pill">
              <span
                className="inline-block h-3.5 w-3.5 rounded-full border border-black/10"
                style={{ backgroundColor: c }}
              />
              {c}
            </span>
          ))}
        </dd>
      </div>
      {profile.candidate_images.length > 0 && (
        <div>
          <dt className="demo-section-title text-xs uppercase tracking-wide">
            Candidate ad images
          </dt>
          <dd className="mt-1 flex flex-wrap gap-2">
            {profile.candidate_images.map((src, i) => (
              <a
                key={i}
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                title={src}
                className="block h-16 w-16 overflow-hidden rounded-lg border border-black/10 bg-white"
              >
                <img
                  src={src}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </a>
            ))}
          </dd>
        </div>
      )}
    </dl>
  )
}

/**
 * Friendly fallback: rate-limit / AI-down notice plus a real captured run —
 * rendered with the same two-tab layout as a live result.
 */
function DemoResult({ demo }: { demo: DemoResponse }) {
  const [tab, setTab] = useState<'brand' | 'info'>('brand')
  const { extraction, profile, ads } = demo.sample
  const brand = (() => {
    try {
      return new URL(demo.sample.sourceUrl).hostname.replace(/^www\./, '')
    } catch {
      return 'sample brand'
    }
  })()

  return (
    <div className="rise-in space-y-6">
      <section className="demo-alert text-sm">
        <h2 className="mb-1 font-bold">
          {demo.reason === 'rate_limited'
            ? 'Demo limit reached'
            : 'Live generation is briefly unavailable'}
        </h2>
        <p>{demo.message}</p>
      </section>

      <nav className="flex gap-2">
        <button
          type="button"
          className={
            tab === 'brand' ? 'demo-button' : 'demo-button demo-button-secondary'
          }
          onClick={() => setTab('brand')}
        >
          Brand profile & ads
        </button>
        <button
          type="button"
          className={
            tab === 'info' ? 'demo-button' : 'demo-button demo-button-secondary'
          }
          onClick={() => setTab('info')}
        >
          Site info
        </button>
      </nav>

      {tab === 'brand' && (
        <>
          <section className="demo-panel">
            <p className="island-kicker mb-2">Brand profile · {brand}</p>
            <BrandProfileFields profile={profile} />
          </section>

          <section className="space-y-4">
            <h2 className="demo-section-title text-lg">
              Ad variants ({ads.length})
            </h2>
            {ads.map((ad, i) => (
              <div key={i}>
                <p className="demo-muted mb-1.5 text-xs font-semibold tracking-wide">
                  {ad.concept}
                </p>
                <article className="ad-preview">
                  <div className="flex items-center gap-2 px-4 py-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-(--lagoon-deep) text-sm font-bold text-white">
                      {brand.charAt(0).toUpperCase()}
                    </span>
                    <div className="leading-tight">
                      <p className="text-sm font-semibold text-gray-900">
                        {brand}
                      </p>
                      <p className="text-xs text-gray-500">Sponsored</p>
                    </div>
                  </div>
                  <p className="px-4 pb-3 text-sm text-gray-800">
                    {ad.primary_text}
                  </p>
                  {ad.image_url && (
                    <div className="bg-gray-100">
                      <img
                        src={ad.image_url}
                        alt={ad.headline}
                        loading="lazy"
                        className="max-h-72 w-full object-cover"
                      />
                    </div>
                  )}
                  <div className="flex items-center gap-3 border-t border-gray-200 bg-gray-50 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] uppercase text-gray-400">
                        {brand}
                      </p>
                      <p className="text-sm font-bold text-gray-900">
                        {ad.headline}
                      </p>
                      <p className="text-xs text-gray-600">{ad.description}</p>
                    </div>
                    <span className="shrink-0 whitespace-nowrap rounded-lg bg-(--lagoon-deep) px-4 py-2 text-sm font-semibold text-white">
                      {ad.cta}
                    </span>
                  </div>
                </article>
              </div>
            ))}
          </section>
        </>
      )}

      {tab === 'info' && (
        <div className="space-y-4">
          <section className="demo-card">
            <h2 className="demo-section-title">
              {extraction.title ?? '(no title)'}
            </h2>
            <p className="demo-muted text-xs">{extraction.finalUrl}</p>
          </section>

          <section className="demo-card">
            <h2 className="demo-section-title mb-2">
              Meta tags ({extraction.meta.length})
            </h2>
            <div className="demo-table-shell max-h-64 overflow-auto">
              <table className="demo-table text-xs">
                <tbody>
                  {extraction.meta.map((m, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap font-mono">{m.name}</td>
                      <td>{m.content}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="demo-card">
            <h2 className="demo-section-title mb-2">
              Images ({extraction.images.length})
            </h2>
            <div className="flex max-h-64 flex-wrap gap-2 overflow-auto">
              {extraction.images.map((img, i) => (
                <a
                  key={i}
                  href={img.src}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={img.alt ?? img.src}
                  className="block h-16 w-16 overflow-hidden rounded-lg border border-black/10 bg-white"
                >
                  <img
                    src={img.src}
                    alt={img.alt ?? ''}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </a>
              ))}
            </div>
          </section>

          <section className="demo-card">
            <h2 className="demo-section-title mb-2">
              Text content ({extraction.textTotalChars.toLocaleString()} chars
              {extraction.text.length < extraction.textTotalChars &&
                `, first ${extraction.text.length.toLocaleString()} shown`}
              )
            </h2>
            <pre className="demo-code-block max-h-96 overflow-auto whitespace-pre-wrap text-xs">
              {extraction.text}
            </pre>
          </section>
        </div>
      )}
    </div>
  )
}
