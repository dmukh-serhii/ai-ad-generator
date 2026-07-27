import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Snaprime — AI ad generator',
      },
      {
        name: 'theme-color',
        content: '#328f97',
      },
      {
        name: 'description',
        content:
          'Turn any website into ready-to-run ads. Paste a URL — Snaprime builds a brand profile and writes on-brand ad variants you can edit in place.',
      },
    ],
    links: [
      { rel: 'icon', href: '/logo.svg', type: 'image/svg+xml' },
      { rel: 'icon', href: '/favicon.ico', sizes: '32x32' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      { rel: 'manifest', href: '/manifest.json' },
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    // The app's panels are designed light-first; pin the template's theme so
    // OS dark mode can't flip text colors out from under them.
    <html lang="en" data-theme="light" style={{ colorScheme: 'light' }}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
