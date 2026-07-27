import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { getAuthUser, publicUser } from '#/lib/auth'

export const Route = createFileRoute('/api/me')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await getAuthUser(request)
        if (!auth.ok) return auth.response
        return Response.json({ user: publicUser(auth.user) })
      },

      // Any logged-in user may set their own Gemini API key.
      PATCH: async ({ request }) => {
        const auth = await getAuthUser(request)
        if (!auth.ok) return auth.response

        let key: string | null
        try {
          const body = (await request.json()) as { gemini_api_key?: string | null }
          key = body.gemini_api_key ? String(body.gemini_api_key).trim() : null
          if (key && (key.length < 20 || key.length > 200)) {
            throw new Error('that does not look like a Gemini API key')
          }
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 400 })
        }

        await env.DB.prepare(
          "UPDATE users SET gemini_api_key = ?, updated_at = datetime('now') WHERE id = ?",
        )
          .bind(key, auth.user.id)
          .run()
        console.log(
          `[auth] user=${auth.user.username} ${key ? 'set' : 'cleared'} gemini key`,
        )
        return Response.json({
          ok: true,
          gemini_key_set: Boolean(key),
          gemini_key_hint: key ? `…${key.slice(-4)}` : null,
        })
      },
    },
  },
})
