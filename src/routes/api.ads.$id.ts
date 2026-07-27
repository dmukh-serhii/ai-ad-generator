import { createFileRoute } from '@tanstack/react-router'
import {
  getAdRow,
  toStoredAd,
  updateAdFields,
  validateImageUrl,
} from '#/lib/adStore'
import type { EditableField } from '#/lib/adStore'

// Public endpoints: generated ads are editable by the visitor who just
// created them (ids are unguessable UUIDs; edits cost no AI calls).
export const Route = createFileRoute('/api/ads/$id')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const row = await getAdRow(params.id)
        if (!row) return Response.json({ error: 'ad not found' }, { status: 404 })
        return Response.json({ ad: toStoredAd(row) })
      },

      PATCH: async ({ request, params }) => {
        let fields: Partial<Record<EditableField, string | null>>
        let expectedUpdatedAt: string
        try {
          const body = (await request.json()) as {
            fields?: Partial<Record<EditableField, string | null>>
            expected_updated_at?: string
          }
          if (!body.fields || typeof body.fields !== 'object') {
            throw new Error('fields is required')
          }
          if (!body.expected_updated_at) {
            throw new Error('expected_updated_at is required')
          }
          fields = body.fields
          expectedUpdatedAt = body.expected_updated_at
          if ('image_url' in fields) {
            fields.image_url = validateImageUrl(fields.image_url ?? null)
          }
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 400 })
        }

        const result = await updateAdFields(params.id, expectedUpdatedAt, fields)
        if (!result.ok) {
          if (result.conflict) {
            const row = await getAdRow(params.id)
            return Response.json(
              {
                error: 'ad was modified by another operation — reload before editing',
                ad: row ? toStoredAd(row) : null,
              },
              { status: 409 },
            )
          }
          return Response.json({ error: 'no editable fields in request' }, { status: 400 })
        }

        console.log(
          `[ads] updated ${params.id} fields=${Object.keys(fields).join(',')}`,
        )
        return Response.json({ updated_at: result.updated_at })
      },
    },
  },
})
