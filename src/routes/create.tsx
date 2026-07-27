import { createFileRoute, redirect } from '@tanstack/react-router'

// The generator moved to the public home page — keep old links working.
export const Route = createFileRoute('/create')({
  beforeLoad: () => {
    throw redirect({ to: '/' })
  },
})
