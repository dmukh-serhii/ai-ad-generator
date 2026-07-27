import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { hashPassword, publicUser, randomHex, requireAdmin } from '#/lib/auth'
import { usageByUser } from '#/lib/usage'
import type { AuthUser } from '#/lib/auth'

export const Route = createFileRoute('/api/users')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireAdmin(request)
        if (!auth.ok) return auth.response
        const [rows, usage] = await Promise.all([
          env.DB.prepare('SELECT * FROM users ORDER BY created_at').all<AuthUser>(),
          usageByUser(),
        ])
        return Response.json({
          users: rows.results.map((u) => ({
            ...publicUser(u),
            usage: usage[u.id] ?? {
              extract: 0,
              brand_profile: 0,
              generate_ads: 0,
              urls: [],
            },
          })),
        })
      },

      POST: async ({ request }) => {
        const auth = await requireAdmin(request)
        if (!auth.ok) return auth.response

        let username: string
        let password: string
        let role: 'admin' | 'user'
        try {
          const body = (await request.json()) as {
            username?: string
            password?: string
            role?: string
          }
          username = String(body.username ?? '').trim()
          password = String(body.password ?? '')
          role = body.role === 'admin' ? 'admin' : 'user'
          if (!/^[a-zA-Z0-9_.@-]{2,60}$/.test(username)) {
            throw new Error('username must be 2-60 chars (letters, digits, @_.-)')
          }
          if (password.length < 6) {
            throw new Error('password must be at least 6 characters')
          }
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 400 })
        }

        const existing = await env.DB.prepare(
          'SELECT id FROM users WHERE username = ?',
        )
          .bind(username)
          .first()
        if (existing) {
          return Response.json({ error: 'username already taken' }, { status: 409 })
        }

        const id = crypto.randomUUID()
        const salt = randomHex(16)
        const hash = await hashPassword(password, salt)
        await env.DB.prepare(
          'INSERT INTO users (id, username, password_hash, salt, role) VALUES (?, ?, ?, ?, ?)',
        )
          .bind(id, username, hash, salt, role)
          .run()

        const created = await env.DB.prepare('SELECT * FROM users WHERE id = ?')
          .bind(id)
          .first<AuthUser>()
        console.log(`[admin] ${auth.user.username} created user=${username} role=${role}`)
        return Response.json({ user: publicUser(created!) }, { status: 201 })
      },
    },
  },
})
