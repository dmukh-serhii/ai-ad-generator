import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { generateAdVariants } from '#/lib/adVariants'
import { geminiKeyFor } from '#/lib/auth'
import { isRateLimited, resolveRequester } from '#/lib/publicAccess'
import { demoPayload } from '#/lib/sampleResult'
import { logUsage } from '#/lib/usage'
import type { BrandProfile } from '#/lib/brandProfile'
import type { StoredAd } from '#/lib/adStore'

export const Route = createFileRoute('/api/generate-ads')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const requester = await resolveRequester(request)

        let profile: BrandProfile
        let sourceUrl: string
        try {
          const body = (await request.json()) as {
            profile?: BrandProfile
            url?: string
          }
          if (!body.profile || typeof body.profile !== 'object') {
            throw new Error('profile is required')
          }
          profile = body.profile
          sourceUrl = String(body.url ?? '')
        } catch (e) {
          return Response.json(
            { error: `expected JSON body: { "profile": {...}, "url": "..." } — ${(e as Error).message}` },
            { status: 400 },
          )
        }

        if (await isRateLimited(requester)) {
          await logUsage(requester.userId, 'generate_ads', {
            url: sourceUrl || null,
            ip: requester.ip,
            outcome: 'rate_limited',
          })
          console.log(`[generate-ads] rate-limited ip=${requester.ip}`)
          return Response.json(demoPayload('rate_limited'))
        }

        const generation = await generateAdVariants(profile, {
          apiKey: requester.user ? geminiKeyFor(requester.user) : undefined,
        })

        if (generation.ads.length === 0) {
          await logUsage(requester.userId, 'generate_ads', {
            url: sourceUrl || null,
            ip: requester.ip,
            outcome: 'gemini_error',
          })
          // Anonymous visitors get the pre-generated example instead of a raw
          // Gemini failure; logged-in users keep the real error for debugging.
          if (!requester.authed) {
            console.log(
              `[generate-ads] gemini failed for public ip=${requester.ip}: ${generation.error}`,
            )
            return Response.json(demoPayload('gemini_unavailable'))
          }
          return Response.json(
            {
              ads: [],
              error: generation.error ?? 'no ads generated',
              model: generation.model,
              latencyMs: generation.latencyMs,
              usage: generation.usage,
              costUsd: generation.costUsd,
              rateLimited: generation.rateLimited,
            },
            { status: 502 },
          )
        }

        await logUsage(requester.userId, 'generate_ads', {
          url: sourceUrl || null,
          ip: requester.ip,
          outcome: 'success',
        })

        const now = new Date().toISOString()
        const profileJson = JSON.stringify(profile)
        const stored: Array<StoredAd> = generation.ads.map((ad) => ({
          id: crypto.randomUUID(),
          source_url: sourceUrl,
          ...ad,
          created_at: now,
          updated_at: now,
        }))

        const insert = env.DB.prepare(
          `INSERT INTO ads (id, source_url, concept, primary_text, headline, description, cta, image_url, brand_profile_json, model, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        await env.DB.batch(
          stored.map((ad) =>
            insert.bind(
              ad.id,
              ad.source_url,
              ad.concept,
              ad.primary_text,
              ad.headline,
              ad.description,
              ad.cta,
              ad.image_url,
              profileJson,
              generation.model,
              ad.created_at,
              ad.updated_at,
            ),
          ),
        )
        console.log(
          `[generate-ads] persisted ${stored.length} ads for ${sourceUrl || '(no url)'}`,
        )

        return Response.json({
          ads: stored,
          error: generation.error,
          model: generation.model,
          latencyMs: generation.latencyMs,
          usage: generation.usage,
          costUsd: generation.costUsd,
        })
      },
    },
  },
})
