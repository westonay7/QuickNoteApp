/**
 * Supabase authentication redirect & callback utilities.
 *
 * Production GitHub Pages URL is used for email verification links so users
 * clicking "Confirm your email address" in Gmail are sent to QuickNote on
 * GitHub Pages instead of http://localhost:3000. Local development on
 * localhost continues to redirect back to localhost.
 */

export const PRODUCTION_SITE_URL = 'https://westonay7.github.io/'

export interface AuthCallbackPayload {
  code: string | null
  tokenHash: string | null
  type: string | null
  accessToken: string | null
  refreshToken: string | null
  error: string | null
  errorCode: string | null
  errorDescription: string | null
  hasAuthParams: boolean
}

function isLocalhostHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

/**
 * Returns the email confirmation redirect URL for Supabase `signUp` and `resend`.
 * - In local development (`npm run dev` on localhost): keeps `http://localhost:<port>/`
 * - In production: uses `https://westonay7.github.io/` (or `VITE_SITE_URL` if set)
 */
export function getEmailRedirectUrl(): string {
  if (typeof window !== 'undefined' && import.meta.env.DEV && isLocalhostHost(window.location.hostname)) {
    return `${window.location.origin}/`
  }

  const configured = (import.meta.env.VITE_SITE_URL as string | undefined)?.trim()
  if (configured && /^https?:\/\//.test(configured)) {
    return configured.endsWith('/') ? configured : `${configured}/`
  }

  return PRODUCTION_SITE_URL
}

/**
 * Returns the password reset redirect URL for Supabase `resetPasswordForEmail`.
 */
export function getPasswordResetRedirectUrl(): string {
  if (typeof window !== 'undefined' && import.meta.env.DEV && isLocalhostHost(window.location.hostname)) {
    return `${window.location.origin}/reset-password`
  }

  const base = import.meta.env.BASE_URL || '/'
  const prefix = base.endsWith('/') ? base : `${base}/`

  if (typeof window !== 'undefined' && !isLocalhostHost(window.location.hostname)) {
    return `${window.location.origin}${prefix}reset-password`
  }

  return `${PRODUCTION_SITE_URL}reset-password`
}

/**
 * Parses Supabase auth callback parameters from both URL query string (`?code=...`,
 * `?token_hash=...`, `?error=...`) and URL hash fragment (`#access_token=...`,
 * `#error=...&error_code=otp_expired`).
 */
export function parseAuthCallbackFromLocation(loc?: Pick<Location, 'search' | 'hash'>): AuthCallbackPayload {
  const source = loc ?? (typeof window !== 'undefined' ? window.location : null)
  if (!source) {
    return {
      code: null,
      tokenHash: null,
      type: null,
      accessToken: null,
      refreshToken: null,
      error: null,
      errorCode: null,
      errorDescription: null,
      hasAuthParams: false,
    }
  }

  const query = new URLSearchParams(source.search)
  const rawHash = source.hash.startsWith('#') ? source.hash.slice(1) : source.hash
  const hash = new URLSearchParams(rawHash.includes('=') ? rawHash : '')

  const code = query.get('code')
  const tokenHash = query.get('token_hash')
  const type = query.get('type') ?? hash.get('type')
  const accessToken = hash.get('access_token')
  const refreshToken = hash.get('refresh_token')
  const error = query.get('error') ?? hash.get('error')
  const errorCode = query.get('error_code') ?? hash.get('error_code')
  const errorDescription = query.get('error_description') ?? hash.get('error_description')

  const hasAuthParams = Boolean(code || tokenHash || accessToken || error || errorCode)

  return {
    code,
    tokenHash,
    type,
    accessToken,
    refreshToken,
    error,
    errorCode,
    errorDescription,
    hasAuthParams,
  }
}

/**
 * Snapshot initial URL auth parameters synchronously at module load time,
 * BEFORE `createClient(..., { auth: { detectSessionInUrl: true } })` strips
 * `#access_token` or `?code` from `window.location`.
 */
let pendingAuthCallback: AuthCallbackPayload | null = (() => {
  const parsed = parseAuthCallbackFromLocation()
  return parsed.hasAuthParams ? parsed : null
})()

export function getPendingAuthCallback(): AuthCallbackPayload | null {
  if (pendingAuthCallback?.hasAuthParams) {
    return pendingAuthCallback
  }
  const live = parseAuthCallbackFromLocation()
  if (live.hasAuthParams) {
    pendingAuthCallback = live
    return live
  }
  return null
}

export function clearPendingAuthCallback(): void {
  pendingAuthCallback = null
}

/**
 * Removes Supabase auth callback query/hash parameters from the address bar
 * without reloading the page.
 */
export function cleanAuthCallbackUrl(): void {
  if (typeof window === 'undefined') return
  try {
    const url = new URL(window.location.href)
    const keysToStrip = ['code', 'token_hash', 'type', 'error', 'error_code', 'error_description']
    let changed = false
    for (const key of keysToStrip) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key)
        changed = true
      }
    }
    if (
      url.hash &&
      /(?:access_token|refresh_token|error|error_code|error_description|type)=/.test(url.hash)
    ) {
      url.hash = ''
      changed = true
    }
    if (changed) {
      const next = `${url.pathname}${url.search}${url.hash}`
      window.history.replaceState(window.history.state, '', next)
    }
  } catch {
    /* non-fatal */
  }
}
