import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Clock, MailCheck } from 'lucide-react'
import { AuthLayout } from '@/components/AuthLayout'
import { Button, CenterSpinner, Field, Input } from '@/components/ui'
import {
  cleanAuthCallbackUrl,
  clearPendingAuthCallback,
  getEmailRedirectUrl,
  getPendingAuthCallback,
} from '@/lib/authRedirect'
import { friendlyError, getSupabase } from '@/lib/supabase'
import { useToast } from '@/state/ToastContext'

type VerificationStatus = 'working' | 'verified' | 'already-confirmed' | 'expired' | 'invalid'

function classifyAuthError(code: string | null, description: string | null): 'already-confirmed' | 'expired' | 'invalid' {
  const text = `${code ?? ''} ${description ?? ''}`.toLowerCase()
  if (text.includes('already confirmed') || text.includes('already verified')) {
    return 'already-confirmed'
  }
  if (text.includes('otp_expired') || text.includes('expired')) {
    return 'expired'
  }
  return 'invalid'
}

/**
 * Handles Supabase email confirmation & auth redirects on both `/` (production
 * GitHub Pages root redirect) and `/auth/callback`.
 *
 * Supports implicit hash tokens (`#access_token=...&type=signup`), PKCE
 * (`?code=...`), token-hash links (`?token_hash=...&type=signup`), and
 * error callbacks (`#error=...&error_code=otp_expired`).
 */
export function AuthCallback() {
  const [status, setStatus] = useState<VerificationStatus>('working')
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null)
  const [hasActiveSession, setHasActiveSession] = useState(false)
  const [detailMessage, setDetailMessage] = useState('')
  const [resendEmail, setResendEmail] = useState('')
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)
  const [signingOutForLogin, setSigningOutForLogin] = useState(false)

  const startedRef = useRef(false)
  const navigate = useNavigate()
  const toast = useToast()

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    const run = async () => {
      const sb = getSupabase()
      const payload = getPendingAuthCallback()

      try {
        // 1. Handle explicit Supabase redirect error (expired, already used, invalid)
        if (payload?.error || payload?.errorCode) {
        const { data: existing } = await sb.auth.getSession().catch(() => ({ data: { session: null } }))
        if (existing.session?.user?.email_confirmed_at) {
          setVerifiedEmail(existing.session.user.email ?? null)
          setHasActiveSession(true)
          setStatus('already-confirmed')
          return
        }

        const kind = classifyAuthError(payload.errorCode, payload.errorDescription ?? payload.error)
        setStatus(kind)
        if (kind === 'already-confirmed') {
          setDetailMessage('Your email address has already been confirmed. You can sign in to QuickNote now.')
        } else if (kind === 'expired') {
          setDetailMessage(
            'This email confirmation link has expired or was already used. If you already verified your account, you can sign in below — otherwise request a fresh verification link.',
          )
        } else {
          setDetailMessage(
            payload.errorDescription
              ? decodeURIComponent(payload.errorDescription.replace(/\+/g, ' '))
              : 'This confirmation link is invalid or incomplete. Please request a fresh verification email.',
          )
        }
          return
        }

        // 2. Token-hash confirmation link (?token_hash=...&type=signup|email|email_change)
        if (payload?.tokenHash) {
          const otpType =
            payload.type === 'recovery' || payload.type === 'email_change' || payload.type === 'email'
              ? payload.type
              : 'signup'
          const { data, error } = await sb.auth.verifyOtp({
            token_hash: payload.tokenHash,
            type: otpType,
          })
          if (error) throw error
          const email = data.user?.email ?? data.session?.user?.email ?? null
          setVerifiedEmail(email)
          setHasActiveSession(Boolean(data.session))
          setStatus('verified')
          return
        }

        // 3. PKCE confirmation link (?code=...)
        if (payload?.code) {
          // Wait briefly in case detectSessionInUrl is already exchanging the same code
          const { data: pre } = await sb.auth.getSession()
          if (pre.session) {
            setVerifiedEmail(pre.session.user.email ?? null)
            setHasActiveSession(true)
            setStatus('verified')
            return
          }

          const { data, error } = await sb.auth.exchangeCodeForSession(payload.code)
          if (error) {
            // Re-check session in case detectSessionInUrl finished the exchange first
            const { data: post } = await sb.auth.getSession()
            if (post.session) {
              setVerifiedEmail(post.session.user.email ?? null)
              setHasActiveSession(true)
              setStatus('verified')
              return
            }
            throw error
          }

          setVerifiedEmail(data.user?.email ?? data.session?.user?.email ?? null)
          setHasActiveSession(Boolean(data.session))
          setStatus('verified')
          return
        }

        // 4. Implicit hash redirect (#access_token=...&refresh_token=...&type=signup)
        // `detectSessionInUrl: true` processes hash tokens automatically; wait briefly for it.
        for (let i = 0; i < 16; i++) {
          const { data } = await sb.auth.getSession()
          if (data.session) {
            setVerifiedEmail(data.session.user.email ?? null)
            setHasActiveSession(true)
            setStatus(payload?.hasAuthParams ? 'verified' : 'already-confirmed')
            return
          }
          await new Promise((r) => setTimeout(r, 150))
        }

        // Explicit fallback if hash tokens were captured before Supabase hydrated them
        if (payload?.accessToken && payload?.refreshToken) {
          const { data, error } = await sb.auth.setSession({
            access_token: payload.accessToken,
            refresh_token: payload.refreshToken,
          })
          if (error) throw error
          if (data.session) {
            setVerifiedEmail(data.session.user.email ?? null)
            setHasActiveSession(true)
            setStatus('verified')
            return
          }
        }

        setStatus(payload?.hasAuthParams ? 'expired' : 'invalid')
        setDetailMessage(
          payload?.hasAuthParams
            ? 'This confirmation link has expired or was already used. Try signing in below, or request a new confirmation email.'
            : 'No verification token was found in this link. Please open the confirmation link directly from your email.',
        )
      } catch (err) {
        const errObj = err as { code?: string; message?: string } | null
        const rawMessage = (err instanceof Error ? err.message : errObj?.message) ?? ''
        const kind = classifyAuthError(errObj?.code ?? null, rawMessage)
        setStatus(kind)
        if (kind === 'already-confirmed') {
          setDetailMessage('Your email address has already been confirmed. You can sign in to QuickNote now.')
        } else if (kind === 'expired') {
          setDetailMessage(
            'This email confirmation link has expired or was already used. If your email is already confirmed, sign in below — or request a new confirmation email.',
          )
        } else {
          setDetailMessage(friendlyError(err))
        }
      } finally {
        // Clear sensitive tokens/codes/errors from the address bar once Supabase has processed them
        cleanAuthCallbackUrl()
      }
    }

    void run()
  }, [])

  const handleProceedToSignIn = async () => {
    setSigningOutForLogin(true)
    try {
      clearPendingAuthCallback()
      // End the auto-created callback session so the user can sign in cleanly on /signin
      if (hasActiveSession) {
        await getSupabase().auth.signOut().catch(() => undefined)
      }
      navigate('/signin?notice=verified', {
        replace: true,
        state: verifiedEmail ? { email: verifiedEmail } : undefined,
      })
    } finally {
      setSigningOutForLogin(false)
    }
  }

  const handleContinueToApp = () => {
    clearPendingAuthCallback()
    navigate('/app', { replace: true })
  }

  const handleGoToSignInPlain = () => {
    clearPendingAuthCallback()
    navigate('/signin', { replace: true })
  }

  const handleResend = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = resendEmail.trim()
    if (!trimmed) return
    setResending(true)
    try {
      const { error } = await getSupabase().auth.resend({
        type: 'signup',
        email: trimmed,
        options: { emailRedirectTo: getEmailRedirectUrl() },
      })
      if (error) throw new Error(friendlyError(error))
      setResent(true)
      toast.success('A new confirmation email has been sent. Check your inbox.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not resend the confirmation email.')
    } finally {
      setResending(false)
    }
  }

  const title =
    status === 'verified'
      ? 'Email verified!'
      : status === 'already-confirmed'
        ? 'Already verified'
        : status === 'expired'
          ? 'Confirmation link expired'
          : status === 'invalid'
            ? 'Invalid confirmation link'
            : 'Verifying your email…'

  const subtitle =
    status === 'verified'
      ? 'Your QuickNote account is ready.'
      : status === 'already-confirmed'
        ? 'Your email address is already confirmed.'
        : status === 'expired'
          ? 'This verification link can no longer be used.'
          : status === 'invalid'
            ? 'We could not verify this confirmation link.'
            : 'Confirming your email address with QuickNote.'

  return (
    <AuthLayout title={title} subtitle={subtitle}>
      <div className="card p-6 text-center">
        {status === 'working' && <CenterSpinner label="Verifying your email address" />}

        {status === 'verified' && (
          <div className="animate-slide-up">
            <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/70 dark:text-emerald-400">
              <CheckCircle2 className="h-6 w-6" aria-hidden />
            </span>
            <p className="text-sm font-medium leading-relaxed text-zinc-800 dark:text-zinc-100">
              Gmail authorized! Your email has been successfully verified. You can now sign in to QuickNote.
            </p>
            {verifiedEmail && (
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                Verified account: <span className="font-semibold text-zinc-700 dark:text-zinc-200">{verifiedEmail}</span>
              </p>
            )}
            <div className="mt-5 flex flex-col gap-2">
              <Button
                className="w-full"
                loading={signingOutForLogin}
                onClick={() => void handleProceedToSignIn()}
              >
                Sign In to QuickNote
              </Button>
              {hasActiveSession && (
                <Button variant="secondary" className="w-full" onClick={handleContinueToApp}>
                  Open QuickNote Workspace
                </Button>
              )}
            </div>
          </div>
        )}

        {status === 'already-confirmed' && (
          <div className="animate-slide-up">
            <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/70 dark:text-brand-400">
              <MailCheck className="h-6 w-6" aria-hidden />
            </span>
            <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
              {detailMessage || 'Your email address is already verified. You can sign in to QuickNote right away.'}
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <Button
                className="w-full"
                loading={signingOutForLogin}
                onClick={() => void handleProceedToSignIn()}
              >
                Go to Sign In
              </Button>
              {hasActiveSession && (
                <Button variant="secondary" className="w-full" onClick={handleContinueToApp}>
                  Open QuickNote Workspace
                </Button>
              )}
            </div>
          </div>
        )}

        {(status === 'expired' || status === 'invalid') && (
          <div className="animate-slide-up">
            <span
              className={
                status === 'expired'
                  ? 'mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/70 dark:text-amber-400'
                  : 'mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-950/70 dark:text-red-400'
              }
            >
              {status === 'expired' ? (
                <Clock className="h-6 w-6" aria-hidden />
              ) : (
                <AlertTriangle className="h-6 w-6" aria-hidden />
              )}
            </span>
            <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{detailMessage}</p>

            {resent ? (
              <div
                role="status"
                className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/60 dark:text-emerald-300"
              >
                Confirmation email sent! Open the newest email in your inbox to verify your account.
              </div>
            ) : (
              <form onSubmit={handleResend} className="mt-5 space-y-3 text-left">
                <Field label="Resend confirmation email" htmlFor="cb-resend-email">
                  <Input
                    id="cb-resend-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    required
                    placeholder="you@gmail.com"
                    value={resendEmail}
                    onChange={(e) => setResendEmail(e.target.value)}
                  />
                </Field>
                <Button type="submit" variant="secondary" className="w-full" loading={resending}>
                  Send new confirmation link
                </Button>
              </form>
            )}

            <div className="mt-4 flex flex-col gap-2">
              <Button className="w-full" onClick={handleGoToSignInPlain}>
                Sign In to QuickNote
              </Button>
              <Link
                to="/signup"
                onClick={clearPendingAuthCallback}
                className="inline-flex h-10 items-center justify-center rounded-lg text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
              >
                Create a new account
              </Link>
            </div>
          </div>
        )}
      </div>
    </AuthLayout>
  )
}
