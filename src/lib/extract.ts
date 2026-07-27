import puppeteer from '@cloudflare/puppeteer'
import type { BrowserWorker } from '@cloudflare/puppeteer'

export interface PageMeta {
  name: string
  content: string
}

export interface PageImage {
  src: string
  alt: string | null
}

export interface Extraction {
  title: string | null
  text: string
  meta: Array<PageMeta>
  images: Array<PageImage>
}

const MAX_TEXT_CHARS = 100_000
const MAX_IMAGES = 200
// Below this much visible text, an HTML document that loads scripts is
// treated as a client-rendered shell and re-fetched through a headless browser.
const SHELL_TEXT_THRESHOLD = 300

/** Tags whose text content is never user-visible page text. */
const NON_CONTENT_TAGS = ['script', 'style', 'noscript', 'template', 'head', 'svg']

/** HTMLRewriter hands back text/attribute values with HTML entities intact. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

export async function extractFromHtml(
  html: string,
  baseUrl: string,
): Promise<Extraction> {
  const meta: Array<PageMeta> = []
  const images: Array<PageImage> = []
  const textParts: Array<string> = []
  let title = ''
  let skipDepth = 0

  const rewriter = new HTMLRewriter()

  for (const tag of NON_CONTENT_TAGS) {
    rewriter.on(tag, {
      element(el) {
        skipDepth++
        el.onEndTag(() => {
          skipDepth--
        })
      },
    })
  }

  rewriter.on('title', {
    text(chunk) {
      title += chunk.text
    },
  })

  rewriter.on('meta', {
    element(el) {
      const name =
        el.getAttribute('name') ??
        el.getAttribute('property') ??
        el.getAttribute('http-equiv') ??
        (el.getAttribute('charset') !== null ? 'charset' : null)
      const content = el.getAttribute('content') ?? el.getAttribute('charset')
      if (name !== null && content !== null) {
        meta.push({ name, content: decodeEntities(content) })
      }
    },
  })

  rewriter.on('img', {
    element(el) {
      if (images.length >= MAX_IMAGES) return
      // data-src covers the common lazy-loading pattern without being domain-specific
      const rawSrc = el.getAttribute('src') ?? el.getAttribute('data-src')
      if (!rawSrc || rawSrc.startsWith('data:')) return
      let src: string
      try {
        src = new URL(decodeEntities(rawSrc), baseUrl).href
      } catch {
        return
      }
      const alt = el.getAttribute('alt')
      images.push({ src, alt: alt === null ? null : decodeEntities(alt) })
    },
  })

  rewriter.onDocument({
    text(chunk) {
      if (skipDepth !== 0) return
      if (chunk.text) textParts.push(chunk.text)
      // The lastInTextNode flag often arrives on a trailing empty chunk,
      // so the separator must be pushed even when chunk.text is empty.
      if (chunk.lastInTextNode) textParts.push(' ')
    },
  })

  // HTMLRewriter parses lazily — consuming the output drives the handlers.
  await rewriter.transform(new Response(html)).arrayBuffer()

  let text = decodeEntities(textParts.join('')).replace(/\s+/g, ' ').trim()
  if (text.length > MAX_TEXT_CHARS) text = text.slice(0, MAX_TEXT_CHARS)

  return { title: decodeEntities(title).trim() || null, text, meta, images }
}

export function looksLikeJsShell(
  extraction: Extraction,
  html: string,
): { shell: boolean; reason: string } {
  const chars = extraction.text.length
  if (chars >= SHELL_TEXT_THRESHOLD) {
    return {
      shell: false,
      reason: `initial HTML has ${chars} chars of visible text`,
    }
  }
  if (!/<script[\s>]/i.test(html)) {
    return {
      shell: false,
      reason: `only ${chars} chars of visible text, but no scripts — page is genuinely small, not a JS shell`,
    }
  }
  return {
    shell: true,
    reason: `only ${chars} chars of visible text in initial HTML while scripts are present — likely a client-rendered shell`,
  }
}

export interface FetchedPage {
  html: string
  finalUrl: string
  status: number
  contentType: string
}

export async function fetchInitialHtml(url: string): Promise<FetchedPage> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(15_000),
  })
  const contentType = res.headers.get('content-type') ?? ''
  if (!res.ok) {
    throw new Error(`upstream responded ${res.status} ${res.statusText}`)
  }
  if (!contentType.includes('html')) {
    throw new Error(`not an HTML page (content-type: ${contentType || 'unknown'})`)
  }
  return {
    html: await res.text(),
    finalUrl: res.url || url,
    status: res.status,
    contentType,
  }
}

export async function renderWithBrowser(
  browserBinding: BrowserRun,
  url: string,
): Promise<{ html: string; finalUrl: string }> {
  const browser = await puppeteer.launch(
    browserBinding as unknown as BrowserWorker,
  )
  try {
    const page = await browser.newPage()
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 20_000 })
    } catch (e) {
      // A timeout just means the page never went network-idle — extract what
      // rendered. Real navigation failures (DNS, connection refused) must
      // propagate, otherwise we'd "extract" Chrome's own error page.
      if (!/timeout/i.test((e as Error).message)) throw e
    }
    return { html: await page.content(), finalUrl: page.url() }
  } finally {
    await browser.close()
  }
}

/** Reject non-http(s) URLs and obvious internal targets. Generic — no per-domain logic. */
export function validateTargetUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('invalid URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('only http(s) URLs are supported')
  }
  const host = url.hostname.toLowerCase()
  const isPrivateIp =
    /^127\.|^10\.|^192\.168\.|^169\.254\.|^0\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  if (host === 'localhost' || host.endsWith('.local') || host === '[::1]' || isPrivateIp) {
    throw new Error('internal addresses are not allowed')
  }
  return url
}
