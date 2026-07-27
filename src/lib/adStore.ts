import { env } from 'cloudflare:workers'

export interface StoredAd {
  id: string
  source_url: string
  concept: string
  primary_text: string
  headline: string
  description: string
  cta: string
  image_url: string | null
  created_at: string
  updated_at: string
}

export const EDITABLE_FIELDS = [
  'concept',
  'primary_text',
  'headline',
  'description',
  'cta',
  'image_url',
] as const
export type EditableField = (typeof EDITABLE_FIELDS)[number]

interface AdRow extends StoredAd {
  brand_profile_json: string
  model: string
}

export async function getAdRow(id: string): Promise<AdRow | null> {
  return await env.DB.prepare('SELECT * FROM ads WHERE id = ?')
    .bind(id)
    .first<AdRow>()
}

export function toStoredAd(row: AdRow): StoredAd {
  const { brand_profile_json: _profile, model: _model, ...ad } = row
  return ad
}

/**
 * Optimistically-locked update: only writes if the row's updated_at still
 * matches what the caller last saw. Concurrent edit/regenerate attempts on
 * the same ad therefore fail with a conflict instead of silently clobbering
 * each other, and other ads' rows are never touched at all.
 */
export async function updateAdFields(
  id: string,
  expectedUpdatedAt: string,
  fields: Partial<Record<EditableField, string | null>>,
): Promise<{ ok: true; updated_at: string } | { ok: false; conflict: boolean }> {
  const entries = Object.entries(fields).filter(([key]) =>
    (EDITABLE_FIELDS as readonly string[]).includes(key),
  )
  if (entries.length === 0) return { ok: false, conflict: false }

  const newUpdatedAt = new Date().toISOString()
  const setClause = entries.map(([key]) => `${key} = ?`).join(', ')
  const result = await env.DB.prepare(
    `UPDATE ads SET ${setClause}, updated_at = ? WHERE id = ? AND updated_at = ?`,
  )
    .bind(...entries.map(([, v]) => v), newUpdatedAt, id, expectedUpdatedAt)
    .run()

  if (result.meta.changes === 0) return { ok: false, conflict: true }
  return { ok: true, updated_at: newUpdatedAt }
}

/** Accept http(s) URLs or reasonably-sized uploaded data-URL images. */
export function validateImageUrl(value: string | null): string | null {
  if (value === null || value === '') return null
  if (value.startsWith('data:image/')) {
    if (value.length > 900_000) {
      throw new Error('uploaded image is too large (max ~600KB file)')
    }
    return value
  }
  const url = new URL(value) // throws on garbage
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('image_url must be http(s) or an uploaded image')
  }
  return url.href
}
