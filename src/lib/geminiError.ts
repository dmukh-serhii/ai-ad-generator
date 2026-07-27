export interface FriendlyGeminiError {
  message: string
  rateLimited: boolean
}

/** Map raw Gemini SDK/API errors to actionable messages for the UI. */
export function friendlyGeminiError(e: unknown): FriendlyGeminiError {
  const raw = e instanceof Error ? e.message : String(e)
  if (/429|RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(raw)) {
    return {
      rateLimited: true,
      message:
        'The Gemini API quota is exhausted (free-tier limit). Wait a minute and retry, or set your own API key on the home page.',
    }
  }
  if (/API key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(raw)) {
    return {
      rateLimited: false,
      message:
        'The Gemini API key is invalid. Set a valid key on the home page (https://aistudio.google.com/apikey).',
    }
  }
  if (/abort|timed?.?out/i.test(raw)) {
    return {
      rateLimited: false,
      message: 'The Gemini call timed out after 15s — try again.',
    }
  }
  return { rateLimited: false, message: raw }
}
