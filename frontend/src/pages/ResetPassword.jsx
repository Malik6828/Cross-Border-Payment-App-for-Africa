import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Eye, EyeOff, ArrowLeft, Check, X, AlertCircle, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../utils/api';
import { getPasswordStrength, getPasswordError } from '../utils/passwordValidator';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const tokenFromUrl = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);

  // Token validation state
  const [tokenStatus, setTokenStatus] = useState('checking'); // 'checking' | 'valid' | 'expired'
  const [expiresAt, setExpiresAt] = useState(null);
  const [countdown, setCountdown] = useState('');

  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Validate token on mount
  useEffect(() => {
    if (!tokenFromUrl.trim()) {
      setTokenStatus('expired');
      return;
    }
    api
      .get(`/auth/reset-password/validate?token=${encodeURIComponent(tokenFromUrl)}`)
      .then((res) => {
        setExpiresAt(new Date(res.data.expires_at).getTime());
        setTokenStatus('valid');
      })
      .catch(() => {
        setTokenStatus('expired');
      });
  }, [tokenFromUrl]);

  // Countdown tick
  useEffect(() => {
    if (tokenStatus !== 'valid' || !expiresAt) return;

    const tick = () => {
      const remaining = Math.ceil((expiresAt - Date.now()) / 1000);
      if (remaining <= 0) {
        setTokenStatus('expired');
        return;
      }
      const mins = Math.floor(remaining / 60);
      const secs = remaining % 60;
      setCountdown(`${mins}m ${String(secs).padStart(2, '0')}s`);
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [tokenStatus, expiresAt]);

  const strength = getPasswordStrength(password);
  const passwordError = touched ? getPasswordError(password) : '';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setTouched(true);

    if (passwordError) {
      toast.error(passwordError);
      return;
    }

    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token: tokenFromUrl, password });
      toast.success('Password reset successfully. Please log in.');
      navigate('/login');
    } catch (err) {
      const msg =
        err.response?.data?.errors?.[0]?.msg ||
        err.response?.data?.error ||
        t('passwordReset.error_generic');
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col px-6 py-8">
      <button type="button" onClick={() => navigate('/login')} className="text-gray-400 hover:text-white mb-6 flex items-center gap-1">
        <ArrowLeft size={18} /> {t('common.back')}
      </button>

      <div className="flex-1 flex flex-col justify-center max-w-sm mx-auto w-full">
        <div className="w-12 h-12 bg-primary-500 rounded-2xl flex items-center justify-center text-2xl mb-6">🔐</div>
        <h2 className="text-2xl font-bold text-white mb-1">{t('passwordReset.reset_title')}</h2>
        <p className="text-gray-400 mb-8">{t('passwordReset.reset_subtitle')}</p>

        {tokenStatus === 'checking' && (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {tokenStatus === 'expired' && (
          <div className="text-center space-y-4">
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-5">
              <AlertCircle size={32} className="text-red-400 mx-auto mb-3" />
              <p className="text-white font-semibold mb-1">This reset link has expired.</p>
              <p className="text-gray-400 text-sm">Reset links are only valid for 1 hour.</p>
            </div>
            <Link
              to="/forgot-password"
              className="block w-full bg-primary-500 hover:bg-primary-600 text-white font-semibold py-3.5 rounded-xl text-center transition-colors"
            >
              Request a new link
            </Link>
          </div>
        )}

        {tokenStatus === 'valid' && (
          <>
            {countdown && (
              <div className="flex items-center gap-2 text-sm text-gray-400 mb-6">
                <Clock size={14} className="shrink-0" />
                {prefersReducedMotion ? (
                  <span>This link expires soon.</span>
                ) : (
                  <span>This link expires in <span className="text-white font-mono">{countdown}</span></span>
                )}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-sm text-gray-400 mb-1 block">{t('passwordReset.new_password')}</label>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onBlur={() => setTouched(true)}
                    className={`w-full bg-gray-800 border rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-primary-500 transition-colors pr-12 ${
                      passwordError ? 'border-red-500' : 'border-gray-700'
                    }`}
                    placeholder={t('login.password_placeholder')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                  >
                    {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {passwordError && (
                  <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                    <AlertCircle size={12} /> {passwordError}
                  </p>
                )}
                {password && (
                  <div className="mt-2 space-y-2">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map(i => (
                        <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= strength.score ? strength.barColor : 'bg-gray-700'}`} />
                      ))}
                    </div>
                    <p className={`text-xs font-medium capitalize ${strength.textColor}`}>{strength.label}</p>
                    <ul className="space-y-1">
                      {[
                        { key: 'length', label: 'At least 8 characters' },
                        { key: 'uppercase', label: 'One uppercase letter' },
                        { key: 'lowercase', label: 'One lowercase letter' },
                        { key: 'number', label: 'One number' },
                        { key: 'special', label: 'One special character' },
                      ].map(({ key, label }) => (
                        <li key={key} className={`flex items-center gap-1.5 text-xs ${strength.checks[key] ? 'text-green-500' : 'text-gray-500'}`}>
                          {strength.checks[key] ? <Check size={12} /> : <X size={12} />} {label}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <button
                type="submit"
                disabled={loading || !!passwordError}
                className="w-full bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white font-semibold py-3.5 rounded-xl transition-colors"
              >
                {loading ? t('passwordReset.reset_submitting') : t('passwordReset.reset_submit')}
              </button>
            </form>
          </>
        )}

        <p className="text-center text-gray-500 mt-6 text-sm">
          <Link to="/login" className="text-primary-500 hover:underline">{t('passwordReset.back_to_login')}</Link>
        </p>
      </div>
    </div>
  );
}
