export interface TokenUsage {
  promptTokens: number
  outputTokens: number
}

// Paid-tier list prices in USD per 1M tokens (mid-2026). On the free tier the
// actual cost is $0 — this is a "what it would cost" estimate for the UI.
const PRICES_PER_MILLION: Record<string, { input: number; output: number }> = {
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
}

export function estimateCostUsd(
  model: string,
  usage: TokenUsage | null,
): number | null {
  if (!usage) return null
  const price = PRICES_PER_MILLION[model]
  if (!price) return null
  return (
    (usage.promptTokens * price.input + usage.outputTokens * price.output) /
    1_000_000
  )
}
