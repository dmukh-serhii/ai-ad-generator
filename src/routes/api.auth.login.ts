import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import {
  ACCOUNT_LIMITED_MESSAGE,
  createSession,
  hashPassword,
  publicUser,
} from '#/lib/auth'
import type { AuthUser } from '#/lib/auth'

export const Route = createFileRoute('/api/auth/login')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let username: string
        let password: string
        try {
          const body = (await request.json()) as {
            username?: string
            password?: string
          }
          username = String(body.username ?? '').trim()
          password = String(body.password ?? '')
          if (!username || !password) throw new Error('missing credentials')
        } catch {
          return Response.json(
            { error: 'username and password are required' },
            { status: 400 },
          )
        }

        const user = await env.DB.prepare(
          'SELECT * FROM users WHERE username = ?',
        )
          .bind(username)
          .first<AuthUser & { password_hash: string; salt: string }>()

        if (!user) {
          return Response.json({ error: 'invalid username or password' }, { status: 401 })
        }

        const hash = await hashPassword(password, user.salt)
        if (hash !== user.password_hash) {
          return Response.json({ error: 'invalid username or password' }, { status: 401 })
        }

        if (user.blacklisted) {
          return Response.json(
            { error: ACCOUNT_LIMITED_MESSAGE, code: 'account_limited' },
            { status: 403 },
          )
        }

        const session = await createSession(user.id, request)
        console.log(`[auth] login user=${user.username}`)
        return Response.json(
          { user: publicUser(user) },
          { headers: { 'set-cookie': session.cookie } },
        )
      },
    },
  },
})
