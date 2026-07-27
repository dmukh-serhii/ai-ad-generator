import { useEffect, useRef, useState } from 'react'
import type { StoredAd } from '#/lib/adStore'

type TextField = 'concept' | 'primary_text' | 'headline' | 'description' | 'cta'

interface EditableFields {
  concept: string
  primary_text: string
  headline: string
  description: string
  cta: string
  image_url: string | null
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

const MAX_UPLOAD_BYTES = 600 * 1024

function pickFields(ad: StoredAd | EditableFields): EditableFields {
  return {
    concept: ad.concept,
    primary_text: ad.primary_text,
    headline: ad.headline,
    description: ad.description,
    cta: ad.cta,
    image_url: ad.image_url,
  }
}

export function AdCard({
  ad,
  candidates,
  onAiUsage,
}: {
  ad: StoredAd
  candidates: Array<string>
  onAiUsage?: (ms: number, costUsd: number | null) => void
}) {
  const [fields, setFields] = useState<EditableFields>(() => pickFields(ad))
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [notice, setNotice] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [regenLoading, setRegenLoading] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  // Refs so async saves always see the latest state without stale closures.
  const fieldsRef = useRef(fields)
  fieldsRef.current = fields
  const lastSavedRef = useRef<EditableFields>(pickFields(ad))
  const updatedAtRef = useRef(ad.updated_at)
  const savingRef = useRef(false)

  const brandName = (() => {
    try {
      return new URL(ad.source_url).hostname.replace(/^www\./, '')
    } catch {
      return 'brand'
    }
  })()

  function dirtyFields(): Partial<EditableFields> {
    const current = fieldsRef.current
    const saved = lastSavedRef.current
    const diff: Partial<EditableFields> = {}
    for (const key of Object.keys(current) as Array<keyof EditableFields>) {
      if (current[key] !== saved[key]) {
        // @ts-expect-error narrow per-key assignment
        diff[key] = current[key]
      }
    }
    return diff
  }

  function adoptServerAd(server: StoredAd) {
    updatedAtRef.current = server.updated_at
    lastSavedRef.current = pickFields(server)
    setFields(pickFields(server))
  }

  async function save() {
    if (savingRef.current || regenLoading) return
    const diff = dirtyFields()
    if (Object.keys(diff).length === 0) return
    savingRef.current = true
    setStatus('saving')
    setNotice(null)
    try {
      const snapshot = { ...fieldsRef.current }
      const res = await fetch(`/api/ads/${ad.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fields: diff,
          expected_updated_at: updatedAtRef.current,
        }),
      })
      const data = (await res.json()) as {
        updated_at?: string
        error?: string
        ad?: StoredAd | null
      }
      if (res.status === 409 && data.ad) {
        adoptServerAd(data.ad)
        setStatus('error')
        setNotice('This ad changed elsewhere — reloaded the latest version.')
        return
      }
      if (!res.ok || !data.updated_at) {
        setStatus('error')
        setNotice(data.error ?? `save failed (${res.status})`)
        return
      }
      updatedAtRef.current = data.updated_at
      lastSavedRef.current = snapshot
      setStatus('saved')
    } catch (e) {
      setStatus('error')
      setNotice((e as Error).message)
    } finally {
      savingRef.current = false
      // Changes may have landed while the request was in flight.
      if (Object.keys(dirtyFields()).length > 0) void save()
    }
  }

  // Debounced autosave whenever a field changes.
  useEffect(() => {
    if (Object.keys(dirtyFields()).length === 0) return
    const t = setTimeout(() => void save(), 800)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields])

  function setText(key: TextField, value: string) {
    setFields((f) => ({ ...f, [key]: value }))
  }

  function setImage(url: string | null) {
    setFields((f) => ({ ...f, image_url: url }))
    setPickerOpen(false)
  }

  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > MAX_UPLOAD_BYTES) {
      setNotice(`image too large (${Math.round(file.size / 1024)}KB, max 600KB)`)
      return
    }
    const reader = new FileReader()
    reader.onload = () => setImage(reader.result as string)
    reader.readAsDataURL(file)
  }

  async function regenerate() {
    if (regenLoading || savingRef.current) return
    setRegenLoading(true)
    setNotice(null)
    setInfo(null)
    try {
      const res = await fetch(`/api/ads/${ad.id}/regenerate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expected_updated_at: updatedAtRef.current }),
      })
      const data = (await res.json()) as {
        ad?: StoredAd | null
        error?: string
        latencyMs?: number
        costUsd?: number | null
      }
      if (res.status === 409 && data.ad) {
        adoptServerAd(data.ad)
        setNotice('This ad changed while regenerating — reloaded, try again.')
        return
      }
      if (!res.ok || !data.ad) {
        setNotice(data.error ?? `regeneration failed (${res.status})`)
        return
      }
      adoptServerAd(data.ad)
      setStatus('saved')
      if (typeof data.latencyMs === 'number') {
        onAiUsage?.(data.latencyMs, data.costUsd ?? null)
        const cost =
          data.costUsd == null ? 'n/a' : `$${data.costUsd.toFixed(5)}`
        setInfo(
          `Regenerated in ${(data.latencyMs / 1000).toFixed(1)}s · est. cost ${cost} (free tier: $0)`,
        )
      }
    } catch (e) {
      setNotice((e as Error).message)
    } finally {
      setRegenLoading(false)
    }
  }

  const inputBase =
    'w-full rounded bg-transparent text-gray-900 focus:bg-teal-50/60 focus:outline-none focus:ring-1 focus:ring-(--lagoon) disabled:opacity-50'

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <input
          value={fields.concept}
          onChange={(e) => setText('concept', e.target.value)}
          onBlur={() => void save()}
          disabled={regenLoading}
          title="Creative concept (editable)"
          className="demo-muted min-w-56 flex-1 basis-64 rounded bg-transparent text-xs font-semibold tracking-wide focus:outline-none focus:ring-1 focus:ring-(--lagoon) disabled:opacity-50"
        />
        <div className="flex shrink-0 items-center gap-2">
          <span className="demo-muted text-xs">
            {status === 'saving' && 'Saving…'}
            {status === 'saved' && 'Saved ✓'}
          </span>
          <button
            type="button"
            onClick={() => void regenerate()}
            disabled={regenLoading}
            className="demo-button demo-button-secondary px-3! py-1.5! text-xs!"
          >
            {regenLoading ? 'Regenerating…' : '↻ Regenerate this ad'}
          </button>
        </div>
      </div>

      <article className={`ad-preview ${regenLoading ? 'opacity-60' : ''}`}>
        {/* Sponsored-post header */}
        <div className="flex items-center gap-2 px-4 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-(--lagoon-deep) text-sm font-bold text-white">
            {brandName.charAt(0).toUpperCase()}
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-gray-900">{brandName}</p>
            <p className="text-xs text-gray-500">Sponsored</p>
          </div>
        </div>

        {/* Primary text */}
        <div className="px-4 pb-3">
          <textarea
            value={fields.primary_text}
            onChange={(e) => setText('primary_text', e.target.value)}
            onBlur={() => void save()}
            disabled={regenLoading}
            rows={3}
            className={`${inputBase} resize-none text-sm`}
          />
        </div>

        {/* Image with swap control */}
        <div className="group relative bg-gray-100">
          {fields.image_url ? (
            <img
              src={fields.image_url}
              alt={fields.headline}
              className="max-h-72 w-full object-cover"
            />
          ) : (
            <div className="flex h-40 items-center justify-center text-sm text-gray-400">
              no image
            </div>
          )}
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            disabled={regenLoading}
            className="absolute right-2 top-2 rounded-lg bg-black/60 px-3 py-1 text-xs font-semibold text-white opacity-0 transition group-hover:opacity-100"
          >
            Change image
          </button>
        </div>

        {pickerOpen && (
          <div className="border-t border-gray-200 bg-gray-50 p-3">
            <p className="mb-2 text-xs font-semibold text-gray-600">
              Pick from page candidates or upload:
            </p>
            <div className="flex flex-wrap gap-2">
              {candidates.map((src) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => setImage(src)}
                  className={`h-16 w-16 overflow-hidden rounded border-2 ${fields.image_url === src ? 'border-(--lagoon-deep)' : 'border-transparent hover:border-(--lagoon)'}`}
                >
                  <img src={src} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
              <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded border-2 border-dashed border-gray-300 text-xs text-gray-500 hover:border-(--lagoon)">
                Upload
                <input
                  type="file"
                  accept="image/*"
                  onChange={onUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        )}

        {/* Link-preview footer: headline + description + CTA */}
        <div className="flex items-center gap-3 border-t border-gray-200 bg-gray-50 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase text-gray-400">{brandName}</p>
            <input
              value={fields.headline}
              onChange={(e) => setText('headline', e.target.value)}
              onBlur={() => void save()}
              disabled={regenLoading}
              className={`${inputBase} text-sm font-bold`}
            />
            <input
              value={fields.description}
              onChange={(e) => setText('description', e.target.value)}
              onBlur={() => void save()}
              disabled={regenLoading}
              className={`${inputBase} text-xs text-gray-600`}
            />
          </div>
          <input
            value={fields.cta}
            onChange={(e) => setText('cta', e.target.value)}
            onBlur={() => void save()}
            disabled={regenLoading}
            size={Math.max(fields.cta.length, 6)}
            className="shrink-0 rounded-lg bg-(--lagoon-deep) px-4 py-2 text-center text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-(--lagoon) disabled:opacity-50"
          />
        </div>
      </article>

      {notice && <p className="mt-1 text-xs text-red-600">{notice}</p>}
      {info && <p className="mt-1 text-xs text-gray-500">{info}</p>}
      <p className="mt-1 text-right text-[10px] text-gray-400">id: {ad.id}</p>
    </div>
  )
}
