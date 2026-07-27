import { GoogleGenAI, Type } from '@google/genai'
import { estimateCostUsd } from '#/lib/aiCost'
import { friendlyGeminiError } from '#/lib/geminiError'
import type { PageImage } from '#/lib/extract'

export interface BrandProfile {
  what_they_do: string
  target_audience: string
  value_proposition: string
  brand_tone: string
  brand_colors: Array<string>
  candidate_images: Array<string>
}

export interface BrandProfileResult {
  profile: BrandProfile
  error: string | null
  model: string
  latencyMs: number
  inputTruncated: boolean
  usage: { promptTokens: number; outputTokens: number } | null
  /** Estimated cost at paid-tier list prices; actual cost on free tier is $0. */
  costUsd: number | null
  /** True when the failure was a Gemini quota / rate limit. */
  rateLimited: boolean
}

// Free-tier model — a conscious cost-saving choice for this assignment (see README).
// Overridable via the GEMINI_MODEL env var.
const DEFAULT_MODEL = 'gemini-2.0-flash'
const TIMEOUT_MS = 15_000
const MAX_INPUT_CHARS = 15_000
const MAX_OUTPUT_TOKENS = 1024
const MAX_IMAGES_IN_PROMPT = 40

const NOT_FOUND = 'not found'

const EMPTY_PROFILE: BrandProfile = {
  what_they_do: NOT_FOUND,
  target_audience: NOT_FOUND,
  value_proposition: NOT_FOUND,
  brand_tone: NOT_FOUND,
  brand_colors: [],
  candidate_images: [],
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    what_they_do: {
      type: Type.STRING,
      description: `What the business does, or "${NOT_FOUND}"`,
    },
    target_audience: {
      type: Type.STRING,
      description: `Who the business targets, or "${NOT_FOUND}"`,
    },
    value_proposition: {
      type: Type.STRING,
      description: `The main value proposition, or "${NOT_FOUND}"`,
    },
    brand_tone: {
      type: Type.STRING,
      description: `The brand tone/voice, or "${NOT_FOUND}"`,
    },
    brand_colors: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '3-5 dominant brand colors as hex or named colors',
    },
    candidate_images: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '3-5 image URLs from the provided list, most usable in ads',
    },
  },
  required: [
    'what_they_do',
    'target_audience',
    'value_proposition',
    'brand_tone',
    'brand_colors',
    'candidate_images',
  ],
}

function buildPrompt(
  text: string,
  images: Array<PageImage>,
  url: string | null,
): string {
  const imageList = images
    .slice(0, MAX_IMAGES_IN_PROMPT)
    .map((img) => `- ${img.src}${img.alt ? ` (alt: ${JSON.stringify(img.alt)})` : ''}`)
    .join('\n')

  return `You are a brand analyst. Analyze the following web page content and produce a brand profile.

STRICT RULES:
- Base every field ONLY on the page content provided below. Never invent, assume, or hallucinate facts that are not supported by the actual content.
- If the content does not give you enough evidence for a field, write exactly "${NOT_FOUND}" for that field (or return an empty array for list fields).
- brand_colors: prefer colors explicitly evidenced by the content (brand names, product descriptions, theme-color meta tags, color words). If not explicitly determinable, you may give a best-effort guess from the industry/context of the page — but only if the page content is sufficient to identify the business at all. 3-5 colors, hex codes or common color names.
- candidate_images: choose 3-5 URLs ONLY from the image list provided below — never construct or modify URLs. Prefer product photos, hero/lifestyle imagery, and logos; avoid icons, tracking pixels, and decorative sprites (filename and alt text are your clues). If the list is empty or nothing qualifies, return an empty array.

${url ? `PAGE URL: ${url}\n` : ''}
PAGE IMAGES (src + alt):
${imageList || '(none)'}

PAGE TEXT CONTENT:
${text}`
}

function coerceProfile(raw: unknown): BrandProfile {
  const obj = (raw ?? {}) as Record<string, unknown>
  const str = (v: unknown): string =>
    typeof v === 'string' && v.trim() ? v.trim() : NOT_FOUND
  const strArray = (v: unknown, max: number): Array<string> =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, max)
      : []
  return {
    what_they_do: str(obj.what_they_do),
    target_audience: str(obj.target_audience),
    value_proposition: str(obj.value_proposition),
    brand_tone: str(obj.brand_tone),
    brand_colors: strArray(obj.brand_colors, 5),
    candidate_images: strArray(obj.candidate_images, 5),
  }
}

export async function generateBrandProfile(input: {
  text: string
  images: Array<PageImage>
  url?: string | null
  /** Per-user key; falls back to the GEMINI_API_KEY env secret. */
  apiKey?: string
}): Promise<BrandProfileResult> {
  const start = Date.now()
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL
  const result: BrandProfileResult = {
    profile: { ...EMPTY_PROFILE },
    error: null,
    model,
    latencyMs: 0,
    inputTruncated: input.text.length > MAX_INPUT_CHARS,
    usage: null,
    costUsd: null,
    rateLimited: false,
  }

  try {
    const apiKey = input.apiKey?.trim() || process.env.GEMINI_API_KEY?.trim()
    if (!apiKey) {
      throw new Error(
        'GEMINI_API_KEY is not set (use `wrangler secret put GEMINI_API_KEY` in production, .dev.vars locally)',
      )
    }

    const text = input.text.slice(0, MAX_INPUT_CHARS)
    const ai = new GoogleGenAI({ apiKey })

    const response = await ai.models.generateContent({
      model,
      contents: buildPrompt(text, input.images, input.url ?? null),
      config: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: 0.2,
        // Hard timeout: abortSignal cancels the request, httpOptions caps the HTTP layer.
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        httpOptions: { timeout: TIMEOUT_MS },
        // Gemini 2.5 models think by default and thinking tokens count against
        // maxOutputTokens, truncating the JSON — this task doesn't need thinking.
        ...(model.includes('2.5')
          ? { thinkingConfig: { thinkingBudget: 0 } }
          : {}),
      },
    })

    result.profile = coerceProfile(JSON.parse(response.text ?? '{}'))

    const meta = response.usageMetadata
    if (meta) {
      result.usage = {
        promptTokens: meta.promptTokenCount ?? 0,
        outputTokens: meta.candidatesTokenCount ?? 0,
      }
    }
  } catch (e) {
    // Partial result with an error flag — callers keep working even if the LLM call dies.
    const friendly = friendlyGeminiError(e)
    result.error = friendly.message
    result.rateLimited = friendly.rateLimited
  }

  result.latencyMs = Date.now() - start
  result.costUsd = estimateCostUsd(model, result.usage)
  console.log(
    `[brand-profile] model=${model} latencyMs=${result.latencyMs} promptTokens=${result.usage?.promptTokens ?? '-'} outputTokens=${result.usage?.outputTokens ?? '-'} costUsd=${result.costUsd ?? '-'} truncated=${result.inputTruncated} error=${result.error ? JSON.stringify(result.error) : 'none'}`,
  )
  return result
}
