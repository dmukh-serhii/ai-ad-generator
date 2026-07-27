import { createFileRoute } from '@tanstack/react-router'
import { generateAdVariants } from '#/lib/adVariants'
import { geminiKeyFor } from '#/lib/auth'
import { isRateLimited, resolveRequester } from '#/lib/publicAccess'
import { GEMINI_DOWN_MESSAGE, RATE_LIMIT_MESSAGE } from '#/lib/sampleResult'
import { logUsage } from '#/lib/usage'
import { getAdRow, toStoredAd, updateAdFields } from '#/lib/adStore'
import type { BrandProfile } from '#/lib/brandProfile'

export const Route = createFileRoute('/api/ads/$id/regenerate')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const requester = await resolveRequester(request)

        let expectedUpdatedAt: string
        try {
          const body = (await request.json()) as { expected_updated_at?: string }
          if (!body.expected_updated_at) {
            throw new Error('expected_updated_at is required')
          }
          expectedUpdatedAt = body.expected_updated_at
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 400 })
        }

        const row = await getAdRow(params.id)
        if (!row) return Response.json({ error: 'ad not found' }, { status: 404 })

        if (await isRateLimited(requester)) {
          await logUsage(requester.userId, 'regenerate_ad', {
            url: row.source_url,
            ip: requester.ip,
            outcome: 'rate_limited',
          })
          return Response.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 })
        }

        let profile: BrandProfile
        try {
          profile = JSON.parse(row.brand_profile_json) as BrandProfile
        } catch {
          return Response.json(
            { error: 'stored brand profile is unreadable' },
            { status: 500 },
          )
        }

        // Regenerate only this ad, steering away from its current concept.
        const generation = await generateAdVariants(profile, {
          single: true,
          avoidConcepts: [row.concept],
          apiKey: requester.user ? geminiKeyFor(requester.user) : undefined,
        })
        const ad = generation.ads[0]
        if (!ad) {
          await logUsage(requester.userId, 'regenerate_ad', {
            url: row.source_url,
            ip: requester.ip,
            outcome: 'gemini_error',
          })
          return Response.json(
            {
              error: requester.authed
                ? (generation.error ?? 'regeneration produced no ad')
                : GEMINI_DOWN_MESSAGE,
            },
            { status: 502 },
          )
        }

        await logUsage(requester.userId, 'regenerate_ad', {
          url: row.source_url,
          ip: requester.ip,
          outcome: 'success',
        })

        // Optimistically-locked write: if the ad was edited since the client
        // last saw it, this fails with 409 instead of overwriting the edit.
        const result = await updateAdFields(params.id, expectedUpdatedAt, {
          concept: ad.concept,
          primary_text: ad.primary_text,
          headline: ad.headline,
          description: ad.description,
          cta: ad.cta,
          image_url: ad.image_url,
        })
        if (!result.ok) {
          const fresh = await getAdRow(params.id)
          return Response.json(
            {
              error: 'ad was modified while regenerating — reload and retry',
              ad: fresh ? toStoredAd(fresh) : null,
            },
            { status: 409 },
          )
        }

        const freshRow = await getAdRow(params.id)
        console.log(`[ads] regenerated ${params.id}`)
        return Response.json({
          ad: freshRow ? toStoredAd(freshRow) : null,
          model: generation.model,
          latencyMs: generation.latencyMs,
          usage: generation.usage,
          costUsd: generation.costUsd,
        })
      },
    },
  },
})
