import { createFileRoute, redirect } from '@tanstack/react-router'

// The login moved behind the admin area — keep old links/bookmarks working.
export const Route = createFileRoute('/login')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/login' })
  },
})
