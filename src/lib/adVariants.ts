import { GoogleGenAI, Type } from '@google/genai'
import { estimateCostUsd } from '#/lib/aiCost'
import { friendlyGeminiError } from '#/lib/geminiError'
import type { BrandProfile } from '#/lib/brandProfile'

export interface AdVariant {
  concept: string
  primary_text: string
  headline: string
  description: string
  cta: string
  image_url: string | null
}

export interface AdVariantsResult {
  ads: Array<AdVariant>
  error: string | null
  model: string
  latencyMs: number
  usage: { promptTokens: number; outputTokens: number } | null
  /** Estimated cost at paid-tier list prices; actual cost on free tier is $0. */
  costUsd: number | null
  /** True when the failure was a Gemini quota / rate limit. */
  rateLimited: boolean
}

const DEFAULT_MODEL = 'gemini-2.0-flash'
const TIMEOUT_MS = 15_000
// The input here is just the brand profile JSON (~500 tokens), so the whole
// call stays tiny — well inside free-tier daily quotas even with the
// extraction call included (see README for the budget math).
const MAX_OUTPUT_TOKENS = 2048
const MAX_ADS = 3

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    ads: {
      type: Type.ARRAY,
      description: '1 to 3 ad variants',
      items: {
        type: Type.OBJECT,
        properties: {
          concept: {
            type: Type.STRING,
            description: 'Short creative concept behind the ad (one sentence)',
          },
          primary_text: {
            type: Type.STRING,
            description: 'Main ad body text, 1-3 sentences',
          },
          headline: { type: Type.STRING, description: 'Short punchy headline' },
          description: {
            type: Type.STRING,
            description: 'Secondary description line',
          },
          cta: {
            type: Type.STRING,
            description: 'Call to action, e.g. "Shop Now"',
          },
          image_url: {
            type: Type.STRING,
            description:
              'Exactly one URL copied verbatim from the candidate_images list, or empty string if the list is empty',
          },
        },
        required: [
          'concept',
          'primary_text',
          'headline',
          'description',
          'cta',
          'image_url',
        ],
      },
    },
  },
  required: ['ads'],
}

export interface GenerateOptions {
  /** Generate exactly one variant (used by per-ad regeneration). */
  single?: boolean
  /** Concepts of existing ads the new variant must differ from. */
  avoidConcepts?: Array<string>
  /** Per-user key; falls back to the GEMINI_API_KEY env secret. */
  apiKey?: string
}

function buildPrompt(profile: BrandProfile, opts: GenerateOptions): string {
  const task = opts.single
    ? 'Create exactly 1 ad variant'
    : 'Create 1-3 ad variants'
  const avoid =
    opts.avoidConcepts && opts.avoidConcepts.length > 0
      ? `\n- Take a creative angle clearly different from these existing ad concepts:\n${opts.avoidConcepts.map((c) => `  - ${c}`).join('\n')}`
      : ''
  return `You are an ad copywriter. ${task} for the business described in the brand profile below.${avoid}

STRICT RULES:
- Stay strictly on-tone: every word of copy must match the brand_tone described in the profile.
- Only reference facts present in the brand profile. Never fabricate claims, statistics, features, discounts, awards, or guarantees that are not in the profile.
- If a profile field says "not found", do not compensate by inventing content for it — write more generic copy instead.
- image_url: pick exactly one URL from the candidate_images list, copied verbatim — never construct, modify, or invent URLs. If candidate_images is empty, use an empty string.
- Each variant should take a distinct creative angle (e.g. value proposition, audience pain point, brand story).

BRAND PROFILE (JSON):
${JSON.stringify(profile, null, 2)}`
}

function coerceAds(raw: unknown, candidates: Array<string>): Array<AdVariant> {
  const obj = (raw ?? {}) as Record<string, unknown>
  if (!Array.isArray(obj.ads)) return []
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  return obj.ads
    .slice(0, MAX_ADS)
    .map((a): AdVariant => {
      const ad = (a ?? {}) as Record<string, unknown>
      const imageUrl = str(ad.image_url)
      return {
        concept: str(ad.concept),
        primary_text: str(ad.primary_text),
        headline: str(ad.headline),
        description: str(ad.description),
        cta: str(ad.cta),
        // Enforce the "no invented URLs" rule server-side too.
        image_url: candidates.includes(imageUrl) ? imageUrl : null,
      }
    })
    .filter((ad) => ad.headline && ad.primary_text)
}

export async function generateAdVariants(
  profile: BrandProfile,
  opts: GenerateOptions = {},
): Promise<AdVariantsResult> {
  const start = Date.now()
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL
  const result: AdVariantsResult = {
    ads: [],
    error: null,
    model,
    latencyMs: 0,
    usage: null,
    costUsd: null,
    rateLimited: false,
  }

  try {
    const apiKey = opts.apiKey?.trim() || process.env.GEMINI_API_KEY?.trim()
    if (!apiKey) {
      throw new Error(
        'GEMINI_API_KEY is not set (use `wrangler secret put GEMINI_API_KEY` in production, .dev.vars locally)',
      )
    }

    const ai = new GoogleGenAI({ apiKey })
    const response = await ai.models.generateContent({
      model,
      contents: buildPrompt(profile, opts),
      config: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: 0.7,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        httpOptions: { timeout: TIMEOUT_MS },
        ...(model.includes('2.5')
          ? { thinkingConfig: { thinkingBudget: 0 } }
          : {}),
      },
    })

    result.ads = coerceAds(
      JSON.parse(response.text ?? '{}'),
      profile.candidate_images,
    )
    if (opts.single) result.ads = result.ads.slice(0, 1)
    if (result.ads.length === 0) {
      result.error = 'model returned no usable ad variants'
    }

    const meta = response.usageMetadata
    if (meta) {
      result.usage = {
        promptTokens: meta.promptTokenCount ?? 0,
        outputTokens: meta.candidatesTokenCount ?? 0,
      }
    }
  } catch (e) {
    const friendly = friendlyGeminiError(e)
    result.error = friendly.message
    result.rateLimited = friendly.rateLimited
  }

  result.latencyMs = Date.now() - start
  result.costUsd = estimateCostUsd(model, result.usage)
  console.log(
    `[ad-variants] model=${model} latencyMs=${result.latencyMs} ads=${result.ads.length} promptTokens=${result.usage?.promptTokens ?? '-'} outputTokens=${result.usage?.outputTokens ?? '-'} costUsd=${result.costUsd ?? '-'} error=${result.error ? JSON.stringify(result.error) : 'none'}`,
  )
  return result
}
