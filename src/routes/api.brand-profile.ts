import { createFileRoute } from '@tanstack/react-router'
import { generateBrandProfile } from '#/lib/brandProfile'
import { geminiKeyFor } from '#/lib/auth'
import { isRateLimited, resolveRequester } from '#/lib/publicAccess'
import { demoPayload } from '#/lib/sampleResult'
import { logUsage } from '#/lib/usage'
import type { PageImage } from '#/lib/extract'

export const Route = createFileRoute('/api/brand-profile')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const requester = await resolveRequester(request)

        let text: string
        let images: Array<PageImage>
        let url: string | null
        try {
          const body = (await request.json()) as {
            text?: string
            images?: Array<PageImage>
            url?: string
          }
          text = String(body.text ?? '')
          images = Array.isArray(body.images) ? body.images : []
          url = body.url ? String(body.url) : null
        } catch {
          return Response.json(
            { error: 'expected JSON body: { "text": "...", "images": [...], "url"?: "..." }' },
            { status: 400 },
          )
        }

        if (!text.trim()) {
          return Response.json({ error: 'text is required' }, { status: 400 })
        }

        if (await isRateLimited(requester)) {
          await logUsage(requester.userId, 'brand_profile', {
            url,
            ip: requester.ip,
            outcome: 'rate_limited',
          })
          console.log(`[brand-profile] rate-limited ip=${requester.ip}`)
          return Response.json(demoPayload('rate_limited'))
        }

        const result = await generateBrandProfile({
          text,
          images,
          url,
          apiKey: requester.user ? geminiKeyFor(requester.user) : undefined,
        })

        // Anonymous visitors never see a raw Gemini failure — serve the
        // pre-generated example instead. Logged-in users keep the real error.
        if (result.error && !requester.authed) {
          await logUsage(requester.userId, 'brand_profile', {
            url,
            ip: requester.ip,
            outcome: 'gemini_error',
          })
          console.log(
            `[brand-profile] gemini failed for public ip=${requester.ip}: ${result.error}`,
          )
          return Response.json(demoPayload('gemini_unavailable'))
        }

        await logUsage(requester.userId, 'brand_profile', {
          url,
          ip: requester.ip,
          outcome: result.error ? 'gemini_error' : 'success',
        })
        return Response.json(result)
      },
    },
  },
})
