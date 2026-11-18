/**
 * Builds an absolute URL for an in-app path.
 *
 * The app is served from the root in development (`/`), but GitHub Pages
 * project sites live under a subpath such as `/QuickNote---A-Premium-Note-App/`.
 * `import.meta.env.BASE_URL` is Vite's configured base, always ending in `/`,
 * so joining it here keeps auth redirects correct in both cases.
 */
export function appUrl(path: string): string {
  const base = import.meta.env.BASE_URL || '/'
  const suffix = path.replace(/^\/+/, '')
  const prefix = base.endsWith('/') ? base : `${base}/`
  return `${window.location.origin}${prefix}${suffix}`
}

/**
 * Safely reads the last visited `/app` route from sessionStorage.
 * Guards against SecurityError in privacy-restricted browsers or WebViews.
 */
export function getLastAppPath(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.sessionStorage.getItem('quicknote-last-path')
    return stored && stored.startsWith('/app') ? stored : null
  } catch {
    return null
  }
}
