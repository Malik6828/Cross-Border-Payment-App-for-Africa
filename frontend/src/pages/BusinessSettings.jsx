import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, ShieldCheck, Building2, Webhook, RefreshCw, Eye, EyeOff, Copy, CheckCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import { truncateAddress } from '../utils/currency';
import toast from 'react-hot-toast';

export default function BusinessSettings() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [signers, setSigners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [upgrading, setUpgrading] = useState(false);
  const [webhooks, setWebhooks] = useState([]);
  const [webhooksLoading, setWebhooksLoading] = useState(true);
  const [rotating, setRotating] = useState(null);
  const [rotateConfirm, setRotateConfirm] = useState(null);
  const [revealedSecret, setRevealedSecret] = useState(null);
  const [copiedSecret, setCopiedSecret] = useState(null);

  const isBusiness = user?.account_type === 'business';

  useEffect(() => {
    api.get('/wallet/signers')
      .then(r => setSigners(r.data.signers))
      .catch(() => toast.error('Failed to load signers'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    api.get('/webhooks')
      .then(r => setWebhooks(r.data.webhooks))
      .catch(() => {})
      .finally(() => setWebhooksLoading(false));
  }, []);

  const handleRotateSecret = async (webhookId) => {
    setRotating(webhookId);
    try {
      const { data } = await api.post(`/webhooks/${webhookId}/rotate-secret`);
      setWebhooks(prev => prev.map(w => w.id === webhookId ? { ...w, secret: data.secret } : w));
      // Auto-reveal the new secret so the user can copy it before it's masked
      setRevealedSecret(webhookId);
      toast.success('Secret rotated successfully');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to rotate secret');
    } finally {
      setRotating(null);
      setRotateConfirm(null);
    }
  };

  const copyWebhookSecret = (id, secret) => {
    navigator.clipboard.writeText(secret);
    setCopiedSecret(id);
    setTimeout(() => setCopiedSecret(null), 2000);
  };

  const handleUpgrade = async () => {
    if (!window.confirm('Upgrade to a Business account? This enables multisig on your Stellar wallet.')) return;
    setUpgrading(true);
    try {
      await api.post('/wallet/upgrade-business');
      setUser(prev => ({ ...prev, account_type: 'business' }));
      toast.success('Account upgraded to Business');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upgrade failed');
    } finally {
      setUpgrading(false);
    }
  };

  const handleAddSigner = async (e) => {
    e.preventDefault();

    // Validate Stellar public key format before submitting
    const key = newKey.trim();
    if (!key.startsWith('G')) {
      toast.error('Invalid Stellar address — must start with "G"');
      return;
    }
    if (key.length !== 56) {
      toast.error(`Invalid Stellar address — must be 56 characters (got ${key.length})`);
      return;
    }
    if (!/^[A-Z0-9]+$/.test(key)) {
      toast.error('Invalid Stellar address — contains invalid characters');
      return;
    }

    setAdding(true);
    try {
      const res = await api.post('/wallet/signers', { signer_public_key: key, label: newLabel.trim() || undefined });
      setSigners(prev => [...prev, { signer_public_key: key, label: newLabel.trim() || null, added_at: new Date().toISOString() }]);
      setNewKey('');
      setNewLabel('');
      toast.success('Signer added');
    } catch (err) {
      toast.error(err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Failed to add signer');
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveSigner = async (signerPublicKey) => {
    if (!window.confirm('Remove this signer? If no signers remain, the account reverts to personal.')) return;
    setRemoving(signerPublicKey);
    try {
      await api.delete(`/wallet/signers/${signerPublicKey}`);
      const remaining = signers.filter(s => s.signer_public_key !== signerPublicKey);
      setSigners(remaining);
      if (remaining.length === 0) {
        setUser(prev => ({ ...prev, account_type: 'personal' }));
        toast.success('Last signer removed — account reverted to personal');
      } else {
        toast.success('Signer removed');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to remove signer');
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="px-4 py-6 max-w-lg mx-auto space-y-6">
      <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white flex items-center gap-1">
        <ArrowLeft size={18} /> Back
      </button>

      <div className="flex items-center gap-3">
        <Building2 size={22} className="text-primary-400" />
        <h2 className="text-2xl font-bold text-white">Business Account</h2>
      </div>

      {/* Upgrade banner */}
      {!isBusiness && (
        <div className="bg-primary-500/10 border border-primary-500/30 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-primary-400">
            <ShieldCheck size={18} />
            <p className="font-semibold">Upgrade to Business</p>
          </div>
          <p className="text-sm text-gray-400">
            Business accounts require 2-of-N signatures for medium and high-threshold operations
            (payments, account changes). Low-threshold ops like trustlines still need only 1 signature.
          </p>
          <button
            onClick={handleUpgrade}
            disabled={upgrading}
            className="w-full bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
          >
            {upgrading ? 'Upgrading…' : 'Upgrade to Business Account'}
          </button>
        </div>
      )}

      {/* Signers list */}
      <div className="bg-gray-900 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-white">Authorized Signers</h3>
          {isBusiness && (
            <span className="text-xs bg-primary-500/20 text-primary-400 px-2 py-0.5 rounded-full">
              threshold: 2-of-N
            </span>
          )}
        </div>

        {loading ? (
          <p className="text-gray-500 text-sm text-center py-4">Loading…</p>
        ) : signers.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-4">No additional signers configured.</p>
        ) : (
          <div className="space-y-2">
            {signers.map(s => (
              <div key={s.signer_public_key} className="flex items-center gap-3 bg-gray-800 rounded-xl px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium truncate">{s.label || 'Unnamed signer'}</p>
                  <p className="text-xs text-gray-500 font-mono">{truncateAddress(s.signer_public_key, 14)}</p>
                </div>
                <button
                  onClick={() => handleRemoveSigner(s.signer_public_key)}
                  disabled={removing === s.signer_public_key}
                  className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-40"
                  aria-label="Remove signer"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add signer form — only for business accounts */}
        {isBusiness && (
          <form onSubmit={handleAddSigner} className="space-y-2 pt-2 border-t border-gray-800">
            <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Add signer</p>
            <input
              type="text"
              required
              placeholder="Stellar public key (G…)"
              value={newKey}
              onChange={e => setNewKey(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white font-mono placeholder-gray-500 focus:outline-none focus:border-primary-500"
            />
            <input
              type="text"
              placeholder="Label (optional)"
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary-500"
            />
            <button
              type="submit"
              disabled={adding}
              className="w-full bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
            >
              <Plus size={16} />
              {adding ? 'Adding…' : 'Add Signer'}
            </button>
          </form>
        )}
      </div>

      {isBusiness && (
        <p className="text-xs text-gray-600 text-center">
          Removing all signers reverts the account to personal and resets thresholds to 1.
        </p>
      )}

      {/* Webhook Configuration */}
      <div className="bg-gray-900 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Webhook size={18} className="text-primary-400" />
          <h3 className="font-semibold text-white">Webhook Configurations</h3>
        </div>

        {webhooksLoading ? (
          <p className="text-gray-500 text-sm text-center py-4">Loading...</p>
        ) : webhooks.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-4">
            No webhooks configured. Create one from the Webhooks page.
          </p>
        ) : (
          <div className="space-y-3">
            {webhooks.map(wh => (
              <div key={wh.id} className="bg-gray-800 rounded-xl p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-white font-mono break-all flex-1">{wh.url}</p>
                  <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                    wh.active ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-400'
                  }`}>
                    {wh.active ? 'active' : 'inactive'}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1">
                  {wh.events.map(ev => (
                    <span key={ev} className="text-xs bg-gray-700 text-gray-300 font-mono px-2 py-0.5 rounded-lg">{ev}</span>
                  ))}
                </div>

                {wh.secret && (
                  <div className="bg-gray-700/50 rounded-lg px-3 py-2 flex items-center gap-2">
                    <span className="text-xs text-gray-400 shrink-0">Secret:</span>
                    <span className="text-xs font-mono text-yellow-400 flex-1 truncate">
                      {revealedSecret === wh.id ? wh.secret : '••••••••••••••••'}
                    </span>
                    <button
                      onClick={() => setRevealedSecret(revealedSecret === wh.id ? null : wh.id)}
                      className="text-gray-500 hover:text-gray-300 shrink-0"
                      aria-label={revealedSecret === wh.id ? 'Hide secret' : 'Reveal secret'}
                    >
                      {revealedSecret === wh.id ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                      onClick={() => copyWebhookSecret(wh.id, wh.secret)}
                      className="text-gray-500 hover:text-gray-300 shrink-0"
                      aria-label="Copy secret"
                    >
                      {copiedSecret === wh.id ? <CheckCheck size={14} className="text-green-400" /> : <Copy size={14} />}
                    </button>
                  </div>
                )}

                <div className="flex gap-2">
                  {rotateConfirm === wh.id ? (
                    <>
                      <button
                        onClick={() => setRotateConfirm(null)}
                        className="flex-1 py-2 rounded-lg bg-gray-700 text-gray-400 text-xs hover:text-white transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleRotateSecret(wh.id)}
                        disabled={rotating === wh.id}
                        className="flex-1 py-2 rounded-lg bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
                      >
                        {rotating === wh.id ? 'Rotating...' : 'Confirm Rotate'}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setRotateConfirm(wh.id)}
                      className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 text-orange-400 text-xs font-medium transition-colors"
                    >
                      <RefreshCw size={12} />
                      Rotate Secret
                    </button>
                  )}
                </div>

                {rotateConfirm === wh.id && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                    <p className="text-xs text-red-400">
                      Warning: Rotating the secret will immediately invalidate the current HMAC signature.
                      Update your server with the new secret before processing new webhook payloads.
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
