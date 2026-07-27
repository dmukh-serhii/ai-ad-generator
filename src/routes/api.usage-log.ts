import { createFileRoute } from '@tanstack/react-router'
import { requireAdmin } from '#/lib/auth'
import { recentEvents } from '#/lib/usage'

export const Route = createFileRoute('/api/usage-log')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireAdmin(request)
        if (!auth.ok) return auth.response
        return Response.json({ events: await recentEvents(200) })
      },
    },
  },
})
