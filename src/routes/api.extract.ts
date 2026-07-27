import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { isRateLimited, resolveRequester } from '#/lib/publicAccess'
import { demoPayload } from '#/lib/sampleResult'
import { logUsage } from '#/lib/usage'
import {
  extractFromHtml,
  fetchInitialHtml,
  looksLikeJsShell,
  renderWithBrowser,
  validateTargetUrl,
} from '#/lib/extract'
import type { Extraction } from '#/lib/extract'

interface ExtractDebug {
  path: 'plain-fetch' | 'headless'
  reason: string
  plainTextChars: number | null
  fetchMs: number | null
  renderMs: number | null
  plainFetchError: string | null
  headlessError: string | null
}

export const Route = createFileRoute('/api/extract')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const requester = await resolveRequester(request)

        let rawUrl: string
        try {
          const body = (await request.json()) as { url?: string }
          rawUrl = String(body.url ?? '')
        } catch {
          return Response.json({ error: 'expected JSON body: { "url": "..." }' }, { status: 400 })
        }

        let target: URL
        try {
          target = validateTargetUrl(rawUrl)
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 400 })
        }

        if (await isRateLimited(requester)) {
          await logUsage(requester.userId, 'extract', {
            url: target.href,
            ip: requester.ip,
            outcome: 'rate_limited',
          })
          console.log(`[extract] rate-limited ip=${requester.ip} url=${target.href}`)
          return Response.json(demoPayload('rate_limited'))
        }

        const debug: ExtractDebug = {
          path: 'plain-fetch',
          reason: '',
          plainTextChars: null,
          fetchMs: null,
          renderMs: null,
          plainFetchError: null,
          headlessError: null,
        }

        let extraction: Extraction | null = null
        let finalUrl = target.href
        let needsHeadless = false

        const fetchStart = Date.now()
        try {
          const fetched = await fetchInitialHtml(target.href)
          debug.fetchMs = Date.now() - fetchStart
          finalUrl = fetched.finalUrl
          extraction = await extractFromHtml(fetched.html, fetched.finalUrl)
          debug.plainTextChars = extraction.text.length

          const shellCheck = looksLikeJsShell(extraction, fetched.html)
          debug.reason = shellCheck.reason
          needsHeadless = shellCheck.shell
        } catch (e) {
          debug.fetchMs = Date.now() - fetchStart
          debug.plainFetchError = (e as Error).message
          debug.reason = `plain fetch failed (${debug.plainFetchError}) — trying headless`
          needsHeadless = true
        }

        if (needsHeadless) {
          const renderStart = Date.now()
          try {
            const rendered = await renderWithBrowser(env.BROWSER, target.href)
            debug.renderMs = Date.now() - renderStart
            debug.path = 'headless'
            finalUrl = rendered.finalUrl
            extraction = await extractFromHtml(rendered.html, rendered.finalUrl)
          } catch (e) {
            debug.renderMs = Date.now() - renderStart
            debug.headlessError = (e as Error).message
            debug.reason += ` | headless rendering failed (${debug.headlessError})`
            // Headless failed — fall through and return whatever the plain
            // fetch produced (possibly nothing) as a partial result.
          }
        }

        // Never hard-fail on a broken/unreadable page: return a partial
        // result with explicit warnings about what's missing and why.
        const empty = { title: null, text: '', meta: [], images: [] }
        const final = extraction ?? empty
        const warnings: Array<string> = []
        if (debug.plainFetchError) {
          warnings.push(`Direct fetch failed: ${debug.plainFetchError}.`)
        }
        if (debug.headlessError) {
          warnings.push(`Headless browser rendering failed: ${debug.headlessError}.`)
        }
        if (extraction === null) {
          warnings.push(
            'Nothing could be extracted from this URL — both the direct fetch and the headless browser fallback failed. The page may be down, blocking bots, or not HTML.',
          )
        } else {
          if (final.text.length === 0) {
            warnings.push(
              'No readable text found on the page — brand profiling needs text, so it is disabled for this result.',
            )
          }
          if (final.images.length === 0) {
            warnings.push('No images found — generated ads will have no image candidates.')
          }
          if (final.meta.length === 0) {
            warnings.push('No meta tags found on the page.')
          }
          if (final.text.length >= 100_000) {
            warnings.push('Page text was very long and was truncated to 100k characters.')
          }
        }

        await logUsage(requester.userId, 'extract', {
          url: target.href,
          ip: requester.ip,
          outcome: extraction === null ? 'error' : 'success',
        })

        console.log(
          `[extract] ip=${requester.ip} url=${target.href} path=${extraction === null ? 'none' : debug.path} textChars=${final.text.length} images=${final.images.length} meta=${final.meta.length} warnings=${warnings.length} reason="${debug.reason}"`,
        )

        return Response.json({
          url: target.href,
          finalUrl,
          ...final,
          warnings,
          debug,
        })
      },
    },
  },
})
