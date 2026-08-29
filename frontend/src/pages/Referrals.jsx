import React, { useEffect, useState } from 'react';
import { Copy, CheckCheck, Users, Gift, Share2 } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import api from '../utils/api';
import toast from 'react-hot-toast';

const DEEP_LINK_PREFIX = 'afripay://register';

export default function Referrals() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);

  useEffect(() => {
    api.get('/referrals/stats')
      .then(r => setStats(r.data))
      .catch(() => toast.error('Failed to load referral stats'))
      .finally(() => setLoading(false));
  }, []);

  const code = stats?.referral_code || '';
  const webLink = code ? `${window.location.origin}/register?ref=${code}` : '';
  const deepLink = code ? `${DEEP_LINK_PREFIX}?ref=${code}` : '';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(webLink);
      setCopied(true);
      toast.success('Referral link copied!');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy referral link');
    }
  };

  const handleShare = async () => {
    const shareData = {
      title: 'Join AfriPay',
      text: `Use my referral link to join AfriPay and earn rewards: ${webLink}`,
      url: webLink,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {
        // user cancelled
      }
    } else {
      handleCopy();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 px-4 py-6">
      <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-6">Refer &amp; Earn</h1>

      <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 shadow-sm mb-4">
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Invite friends to AfriPay. When they complete their first transaction, you earn a{' '}
          <span className="font-semibold text-primary-500">
            {(stats?.credit_per_referral_bps ?? 0) / 100}% fee discount credit
          </span>{' '}
          (valid 90 days).
        </p>

        <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Your referral link</label>
        <div className="flex items-center gap-2 mb-3">
          <input
            readOnly
            value={webLink}
            className="flex-1 bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 text-sm rounded-xl px-3 py-2 truncate"
          />
          <button
            onClick={handleCopy}
            className="p-2 rounded-xl bg-primary-500 text-white hover:bg-primary-600 transition-colors"
            aria-label="Copy referral link"
          >
            {copied ? <CheckCheck size={18} /> : <Copy size={18} />}
          </button>
          <button
            onClick={handleShare}
            className="p-2 rounded-xl bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            aria-label="Share referral link"
          >
            <Share2 size={18} />
          </button>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setShowQR((v) => !v)}
            className="text-xs text-primary-500 hover:text-primary-400 font-medium transition-colors"
          >
            {showQR ? 'Hide QR code' : 'Show QR code'}
          </button>
        </div>

        {showQR && (
          <div className="flex justify-center mt-4">
            <div className="bg-white rounded-xl p-4 inline-flex flex-col items-center gap-2">
              <QRCodeCanvas value={deepLink} size={160} level="M" />
              <p className="text-xs text-gray-500">Scan to join AfriPay</p>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-sm flex flex-col items-center gap-2">
          <Users size={24} className="text-primary-500" />
          <span className="text-2xl font-bold text-gray-900 dark:text-white">{stats?.referral_count ?? 0}</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">Friends referred</span>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-sm flex flex-col items-center gap-2">
          <Gift size={24} className="text-green-500" />
          <span className="text-2xl font-bold text-gray-900 dark:text-white">{stats?.active_credits ?? 0}</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">Active credits</span>
        </div>
      </div>
    </div>
  );
}
