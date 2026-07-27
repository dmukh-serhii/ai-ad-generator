import sampleData from '#/lib/sampleData.json'
import type { BrandProfile } from '#/lib/brandProfile'
import type { PageImage } from '#/lib/extract'

/**
 * A real captured run served when a visitor is rate-limited or the Gemini API
 * is unavailable — the demo keeps showing something real instead of a raw
 * error.
 *
 * sampleData.json is a genuine pipeline output (extract → brand profile →
 * ads). To refresh it: log in (logged-in accounts bypass the rate limit), run
 * a site through the generator, and save the three API responses in the same
 * shape.
 */

export interface SampleAd {
  concept: string
  primary_text: string
  headline: string
  description: string
  cta: string
  image_url: string | null
}

export interface SampleExtraction {
  url: string
  finalUrl: string
  title: string | null
  /** Page text, truncated for bundle size — see textTotalChars. */
  text: string
  textTotalChars: number
  meta: Array<{ name: string; content: string }>
  images: Array<PageImage>
}

export interface SampleResult {
  sourceUrl: string
  extraction: SampleExtraction
  profile: BrandProfile
  ads: Array<SampleAd>
}

export type DemoReason = 'rate_limited' | 'gemini_unavailable'

export interface DemoPayload {
  demo: true
  reason: DemoReason
  message: string
  sample: SampleResult
}

export const RATE_LIMIT_MESSAGE =
  "You've reached the free demo limit for this hour. Live generation will unlock again shortly — meanwhile, here's a real result Snaprime generated from allbirds.com."

export const GEMINI_DOWN_MESSAGE =
  "The AI service is temporarily at capacity, so we can't run a live generation right now. Here's a real result Snaprime generated from allbirds.com — please try your URL again in a few minutes."

export function demoPayload(reason: DemoReason): DemoPayload {
  return {
    demo: true,
    reason,
    message: reason === 'rate_limited' ? RATE_LIMIT_MESSAGE : GEMINI_DOWN_MESSAGE,
    sample: sampleData as SampleResult,
  }
}
