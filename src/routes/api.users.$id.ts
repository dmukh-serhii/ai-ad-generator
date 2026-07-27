import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { hashPassword, publicUser, randomHex, requireAdmin } from '#/lib/auth'
import type { AuthUser } from '#/lib/auth'

export const Route = createFileRoute('/api/users/$id')({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        const auth = await requireAdmin(request)
        if (!auth.ok) return auth.response

        const target = await env.DB.prepare('SELECT * FROM users WHERE id = ?')
          .bind(params.id)
          .first<AuthUser>()
        if (!target) {
          return Response.json({ error: 'user not found' }, { status: 404 })
        }

        let body: {
          username?: string
          password?: string
          role?: string
          blacklisted?: boolean
        }
        try {
          body = (await request.json()) as typeof body
        } catch {
          return Response.json({ error: 'invalid JSON body' }, { status: 400 })
        }

        const sets: Array<string> = []
        const binds: Array<string | number> = []

        if (body.username !== undefined) {
          const username = String(body.username).trim()
          if (!/^[a-zA-Z0-9_.@-]{2,60}$/.test(username)) {
            return Response.json({ error: 'invalid username' }, { status: 400 })
          }
          sets.push('username = ?')
          binds.push(username)
        }
        if (body.password !== undefined && body.password !== '') {
          const password = String(body.password)
          if (password.length < 6) {
            return Response.json(
              { error: 'password must be at least 6 characters' },
              { status: 400 },
            )
          }
          const salt = randomHex(16)
          sets.push('password_hash = ?', 'salt = ?')
          binds.push(await hashPassword(password, salt), salt)
        }
        if (body.role !== undefined) {
          if (params.id === auth.user.id) {
            return Response.json(
              { error: 'you cannot change your own role' },
              { status: 400 },
            )
          }
          sets.push('role = ?')
          binds.push(body.role === 'admin' ? 'admin' : 'user')
        }
        if (body.blacklisted !== undefined) {
          if (params.id === auth.user.id) {
            return Response.json(
              { error: 'you cannot blacklist yourself' },
              { status: 400 },
            )
          }
          sets.push('blacklisted = ?')
          binds.push(body.blacklisted ? 1 : 0)
          // Sessions are intentionally kept: the auth guard destroys them on
          // the user's next request and returns the "rate limits" message.
        }

        if (sets.length === 0) {
          return Response.json({ error: 'nothing to update' }, { status: 400 })
        }

        await env.DB.prepare(
          `UPDATE users SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
        )
          .bind(...binds, params.id)
          .run()

        const updated = await env.DB.prepare('SELECT * FROM users WHERE id = ?')
          .bind(params.id)
          .first<AuthUser>()
        console.log(`[admin] ${auth.user.username} updated user=${target.username}`)
        return Response.json({ user: publicUser(updated!) })
      },

      DELETE: async ({ request, params }) => {
        const auth = await requireAdmin(request)
        if (!auth.ok) return auth.response
        if (params.id === auth.user.id) {
          return Response.json(
            { error: 'you cannot delete yourself' },
            { status: 400 },
          )
        }
        // Their sessions are kept: the auth guard's NULL-join check converts
        // them into the "rate limits" logout on the user's next request.
        const result = await env.DB.prepare('DELETE FROM users WHERE id = ?')
          .bind(params.id)
          .run()
        if (result.meta.changes === 0) {
          return Response.json({ error: 'user not found' }, { status: 404 })
        }
        console.log(`[admin] ${auth.user.username} deleted user id=${params.id}`)
        return Response.json({ ok: true })
      },
    },
  },
})
