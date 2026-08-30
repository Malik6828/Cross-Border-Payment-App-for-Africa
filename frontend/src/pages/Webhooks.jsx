import React, { useState, useEffect, useRef } from 'react';
import { Plus, Webhook, Copy, CheckCheck, Eye, EyeOff, RefreshCw, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';

const ALL_EVENTS = ['payment.sent', 'payment.received', 'payment.failed'];

function DeliveryLog({ webhookId }) {
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [retrying, setRetrying] = useState(null);

  const loadDeliveries = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/webhooks/deliveries?webhook_id=${webhookId}`);
      setDeliveries(data.deliveries);
    } catch {
      toast.error('Failed to load delivery logs');
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = async (deliveryId) => {
    setRetrying(deliveryId);
    try {
      await api.post(`/webhooks/deliveries/${deliveryId}/retry`);
      toast.success('Retry initiated');
      await loadDeliveries();
    } catch {
      toast.error('Failed to retry delivery');
    } finally {
      setRetrying(null);
    }
  };

  useEffect(() => {
    if (expanded) loadDeliveries();
  }, [expanded, webhookId]);

  return (
    <div className="border-t border-gray-700 pt-2 mt-2">
      <button
        onClick={() => setExpanded(s => !s)}
        className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-300 transition-colors"
      >
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {expanded ? 'Hide delivery log' : 'Show delivery log'}
        {!expanded && deliveries.length > 0 && (
          <span className="text-gray-600">({deliveries.length})</span>
        )}
      </button>
      {expanded && (
        <div className="mt-2">
          {loading ? (
            <div className="flex justify-center py-4">
              <div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : deliveries.length === 0 ? (
            <p className="text-xs text-gray-500 py-3 text-center">No delivery records yet.</p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {deliveries.map(d => (
                <div key={d.id} className="bg-gray-800 rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono text-gray-300 truncate">{d.event_type}</span>
                    <span className={`shrink-0 text-xs px-1.5 py-0.5 rounded font-medium ${
                      d.status === 'delivered' ? 'bg-green-500/20 text-green-400' :
                      d.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                      'bg-yellow-500/20 text-yellow-400'
                    }`}>
                      {d.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                    <span>HTTP {d.status_code || '-'}</span>
                    <span>·</span>
                    <span className="flex items-center gap-0.5"><Clock size={10} /> {d.response_time_ms != null ? `${d.response_time_ms}ms` : '-'}</span>
                    <span>·</span>
                    <span>{d.attempt}/{d.max_attempts}</span>
                  </div>
                  {d.status === 'failed' && (
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <span className="text-xs text-red-400 truncate" title={d.error_message}>
                        {d.error_message ? d.error_message.slice(0, 60) : 'Unknown error'}
                      </span>
                      <button
                        onClick={() => handleRetry(d.id)}
                        disabled={retrying === d.id}
                        className="shrink-0 text-xs text-primary-400 hover:text-primary-300 disabled:opacity-50 flex items-center gap-1"
                      >
                        <RefreshCw size={10} className={retrying === d.id ? 'animate-spin' : ''} />
                        Retry
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <button
            onClick={loadDeliveries}
            disabled={loading}
            className="text-xs text-gray-500 hover:text-gray-400 mt-2 flex items-center gap-1"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      )}
    </div>
  );
}

export default function Webhooks() {
  const [webhooks, setWebhooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ url: '', events: [] });
  const [submitting, setSubmitting] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState(null);
  const revealTimerRef = useRef(null);
  const [copied, setCopied] = useState(null);

  useEffect(() => {
    api.get('/webhooks')
      .then(r => setWebhooks(r.data.webhooks))
      .catch(() => toast.error('Failed to load webhooks'))
      .finally(() => setLoading(false));
    return () => clearTimeout(revealTimerRef.current);
  }, []);

  const toggleEvent = (event) => {
    setForm(f => ({
      ...f,
      events: f.events.includes(event) ? f.events.filter(e => e !== event) : [...f.events, event],
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.url.startsWith('https://')) {
      toast.error('Webhook URL must use HTTPS');
      return;
    }
    if (!form.events.length) {
      toast.error('Select at least one event');
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post('/webhooks', form);
      setWebhooks(prev => [data, ...prev]);
      setRevealedSecret(data.id);
      setForm({ url: '', events: [] });
      setShowForm(false);
      toast.success('Webhook created — save your secret now, it won\'t be shown again');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create webhook');
    } finally {
      setSubmitting(false);
    }
  };

  const copySecret = (id, secret) => {
    navigator.clipboard.writeText(secret);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="px-4 py-6 max-w-lg mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">Webhooks</h2>
        <button
          onClick={() => setShowForm(s => !s)}
          className="flex items-center gap-1.5 text-sm bg-primary-500 hover:bg-primary-600 text-white px-3 py-2 rounded-xl transition-colors"
        >
          <Plus size={16} /> Add
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-gray-900 rounded-2xl p-5 space-y-4">
          <div>
            <label className="text-sm text-gray-400 mb-1 block">Endpoint URL (HTTPS only)</label>
            <input
              type="url"
              required
              placeholder="https://example.com/webhook"
              value={form.url}
              onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
              className="w-full bg-gray-800 rounded-xl px-3 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="text-sm text-gray-400 mb-2 block">Events to subscribe</label>
            <div className="space-y-2">
              {ALL_EVENTS.map(event => (
                <label key={event} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.events.includes(event)}
                    onChange={() => toggleEvent(event)}
                    className="accent-primary-500 w-4 h-4"
                  />
                  <span className="text-sm text-gray-300 font-mono">{event}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="flex-1 py-2.5 rounded-xl bg-gray-800 text-gray-400 text-sm hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-2.5 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {submitting ? 'Creating...' : 'Create Webhook'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-10" role="status" aria-label="Loading">
          <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : webhooks.length === 0 ? (
        <div className="bg-gray-900 rounded-2xl p-8 text-center">
          <Webhook size={32} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No webhooks yet. Add one to receive event notifications.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks.map(wh => (
            <div key={wh.id} className="bg-gray-900 rounded-2xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-white font-mono break-all">{wh.url}</p>
                <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${wh.active ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
                  {wh.active ? 'active' : 'inactive'}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {wh.events.map(ev => (
                  <span key={ev} className="text-xs bg-gray-800 text-gray-300 font-mono px-2 py-0.5 rounded-lg">{ev}</span>
                ))}
              </div>
              {wh.secret && (
                <div className="bg-gray-800 rounded-xl px-3 py-2 flex items-center gap-2">
                  <span className="text-xs text-gray-400 shrink-0">Secret:</span>
                  <span className="text-xs font-mono text-yellow-400 flex-1 truncate">
                    {revealedSecret === wh.id ? wh.secret : '••••••••••••••••'}
                  </span>
                  <button onClick={() => {
                    if (revealedSecret === wh.id) {
                      clearTimeout(revealTimerRef.current);
                      setRevealedSecret(null);
                    } else {
                      setRevealedSecret(wh.id);
                      clearTimeout(revealTimerRef.current);
                      revealTimerRef.current = setTimeout(() => setRevealedSecret(null), 30000);
                    }
                  }} className="text-gray-500 hover:text-gray-300 shrink-0">
                    {revealedSecret === wh.id ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button onClick={() => copySecret(wh.id, wh.secret)} className="text-gray-500 hover:text-gray-300 shrink-0">
                    {copied === wh.id ? <CheckCheck size={14} className="text-primary-500" /> : <Copy size={14} />}
                  </button>
                </div>
              )}
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-600">Created {new Date(wh.created_at).toLocaleDateString()}</p>
              </div>
              <DeliveryLog webhookId={wh.id} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
