import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { Eye, EyeOff, ArrowLeft, ShieldCheck, MailCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../utils/api';

export default function Login() {
  const { login, updateUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState({ email: '', password: '' });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(false);

  // Rate-limit cooldown (issue #655) — persisted across refreshes via sessionStorage
  const COOLDOWN_KEY = 'afripay_login_cooldown_until';
  const DEFAULT_COOLDOWN_SECONDS = 60;
  const [secondsLeft, setSecondsLeft] = useState(() => {
    const until = parseInt(sessionStorage.getItem(COOLDOWN_KEY) || '0', 10);
    const remaining = Math.ceil((until - Date.now()) / 1000);
    return remaining > 0 ? remaining : 0;
  });

  // 2FA TOTP step
  const [requires2fa, setRequires2fa] = useState(false);
  const [totp, setTotp] = useState('');
  const totpInputRef = useRef(null);

  // Focus TOTP input when the step becomes visible
  useEffect(() => {
    if (requires2fa && totpInputRef.current) {
      totpInputRef.current.focus();
    }
  }, [requires2fa]);

  // Tick the cooldown down every second; re-enable the button automatically at 0.
  useEffect(() => {
    if (secondsLeft <= 0) return undefined;
    const timer = setInterval(() => {
      const until = parseInt(sessionStorage.getItem(COOLDOWN_KEY) || '0', 10);
      const remaining = Math.ceil((until - Date.now()) / 1000);
      if (remaining <= 0) {
        sessionStorage.removeItem(COOLDOWN_KEY);
        setSecondsLeft(0);
      } else {
        setSecondsLeft(remaining);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  const startCooldown = (seconds) => {
    const until = Date.now() + seconds * 1000;
    sessionStorage.setItem(COOLDOWN_KEY, String(until));
    setSecondsLeft(seconds);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Device-trust is now carried by an httpOnly cookie the backend sets on login
      // (issue #995) — the browser attaches it automatically, no localStorage needed.
      await login(
        form.email,
        form.password,
        rememberDevice ? { rememberDevice: true } : {}
      );
      const redirectParam = searchParams.get('redirect');
      const redirect = redirectParam || sessionStorage.getItem('afripay_redirect');
      sessionStorage.removeItem('afripay_redirect');
      navigate(redirect || '/dashboard');
    } catch (err) {
      const data = err.response?.data;
      if (err.response?.status === 403 && data?.requires_2fa) {
        // Backend signals that a TOTP code is required — switch to TOTP step
        setRequires2fa(true);
      } else if (err.response?.status === 429) {
        // Rate limit exceeded (issue #655) — start a countdown from Retry-After.
        const retryAfter = parseInt(err.response.headers?.['retry-after'], 10);
        startCooldown(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : DEFAULT_COOLDOWN_SECONDS);
      } else {
        toast.error(data?.error || t('login.error'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleTotpChange = async (value) => {
    // Only allow digits
    const digits = value.replace(/\D/g, '').slice(0, 6);
    setTotp(digits);

    // Auto-submit on 6th digit
    if (digits.length === 6) {
      setLoading(true);
      try {
        // Device-trust cookie (httpOnly) is attached automatically by the browser.
        const res = await api.post(
          '/auth/login',
          { email: form.email, password: form.password, totp_code: digits, ...(rememberDevice && { rememberDevice: true }) }
        );
        // Manually set token + user via the same path login() uses
        const { tokenStore } = await import('../context/AuthContext');
        tokenStore.set(res.data.token);
        // Populate AuthContext user from the login response (same as login() does)
        updateUser(res.data.user);
        // Set Sentry user context for error tracking
        const { default: Sentry } = await import('@sentry/react');
        Sentry.setUser({
          id: res.data.user.id,
          wallet: res.data.user.wallet_address
            ? `${res.data.user.wallet_address.slice(0, 4)}...${res.data.user.wallet_address.slice(-4)}`
            : undefined,
        });
        navigate('/dashboard');
      } catch (err) {
        toast.error(err.response?.data?.error || t('login.totp_error', 'Invalid code. Try again.'));
        setTotp('');
        totpInputRef.current?.focus();
      } finally {
        setLoading(false);
      }
    }
  };

  const handleBackToCredentials = () => {
    setRequires2fa(false);
    setTotp('');
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col px-6 py-8 transition-colors duration-200">
      <button
        onClick={requires2fa ? handleBackToCredentials : () => navigate('/')}
        className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white mb-6 flex items-center gap-1 transition-colors"
      >
        <ArrowLeft size={18} /> {t('common.back')}
      </button>

      <div className="flex-1 flex flex-col justify-center max-w-sm mx-auto w-full">
        <div className="w-12 h-12 bg-primary-500 rounded-2xl flex items-center justify-center text-2xl mb-6">
          {requires2fa ? <ShieldCheck size={24} className="text-white" /> : '💸'}
        </div>

        {requires2fa ? (
          /* ── TOTP step ── */
          <>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
              {t('login.totp_title', 'Two-factor authentication')}
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-8">
              {t('login.totp_subtitle', 'Enter the 6-digit code from your authenticator app.')}
            </p>

            <div>
              <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">
                {t('login.totp_label', 'Authentication code')}
              </label>
              <input
                ref={totpInputRef}
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                placeholder="000000"
                value={totp}
                onChange={(e) => handleTotpChange(e.target.value)}
                disabled={loading}
                aria-label={t('login.totp_aria', '6-digit TOTP authentication code')}
                className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-4 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-primary-500 transition-colors shadow-sm text-center text-3xl tracking-[0.5em] font-mono"
              />
              <p className="text-xs text-gray-500 mt-2 text-center">
                {t('login.totp_hint', 'The code submits automatically when all 6 digits are entered.')}
              </p>
            </div>

            {loading && (
              <div className="flex justify-center mt-6">
                <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" role="status" aria-label="Verifying" />
              </div>
            )}
          </>
        ) : (
          /* ── Email / password step ── */
          <>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">{t('login.title')}</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-8">{t('login.subtitle')}</p>

            {emailVerificationRequired && (
              <div
                role="alert"
                className="flex items-start gap-3 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-xl px-4 py-3 mb-6"
              >
                <MailCheck size={18} className="text-blue-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  {t('register.verify_email_notice', 'Account created! Please check your email and verify your address before logging in.')}
                </p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">{t('login.email')}</label>
                <input
                  type="email"
                  required
                  placeholder="[email]"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-primary-500 transition-colors shadow-sm"
                />
              </div>
              <div>
                <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">{t('login.password')}</label>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    required
                    placeholder={t('login.password_placeholder')}
                    value={form.password}
                    onChange={e => setForm({ ...form, password: e.target.value })}
                    className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-primary-500 transition-colors pr-12 shadow-sm"
                  />
                  <button type="button" onClick={() => setShowPass(!showPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-white transition-colors">
                    {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rememberDevice}
                    onChange={(e) => setRememberDevice(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-primary-500 focus:ring-primary-500 cursor-pointer"
                  />
                  <span className="text-sm text-gray-600 dark:text-gray-400">{t('login.remember_device', 'Remember this device for 30 days')}</span>
                </label>
                <Link to="/forgot-password" className="text-sm text-primary-500 hover:underline">
                  {t('login.forgot_password')}
                </Link>
              </div>

              {secondsLeft > 0 && (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="flex items-start gap-2 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400"
                >
                  <ShieldCheck size={16} className="mt-0.5 flex-shrink-0" />
                  <span>
                    {t('login.rate_limited', 'Too many login attempts.')} Please wait {secondsLeft}s before trying again.
                  </span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || secondsLeft > 0}
                className="w-full bg-primary-500 hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl transition-colors mt-2"
              >
                {secondsLeft > 0
                  ? `${t('login.try_again_in', 'Try again in')} ${secondsLeft}s`
                  : loading
                  ? t('login.submitting')
                  : t('login.submit')}
              </button>
            </form>

            <p className="text-center text-gray-500 mt-6 text-sm">
              {t('login.no_account')}{' '}
              <Link to="/register" className="text-primary-500 hover:underline">{t('login.create_one')}</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
