import { createFileRoute } from '@tanstack/react-router'
import { clearSessionCookie, destroySession } from '#/lib/auth'

export const Route = createFileRoute('/api/auth/logout')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const match = (request.headers.get('cookie') ?? '').match(
          /(?:^|;\s*)snaprime_session=([^;]+)/,
        )
        if (match) await destroySession(match[1])
        return Response.json(
          { ok: true },
          { headers: { 'set-cookie': clearSessionCookie() } },
        )
      },
    },
  },
})
