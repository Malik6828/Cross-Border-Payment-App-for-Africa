import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, TrendingUp, Download, FileText, Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';

/** Analytics data is considered stale after this many minutes. */
const STALE_THRESHOLD_MINUTES = 60;


function toDateInput(d) {
  return d.toISOString().slice(0, 10);
}

function defaultRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { from: toDateInput(from), to: toDateInput(to) };
}

export default function Analytics() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user } = useAuth();

  const [range, setRange] = useState(defaultRange);
  const [data, setData] = useState(null);
  const [refreshedAt, setRefreshedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const abortRef = useRef(null);

  const fetchAnalytics = useCallback(async () => {
    // Cancel any in-flight request to prevent stale responses overwriting newer ones
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const res = await api.get(`/payments/analytics?from=${range.from}&to=${range.to}`, {
        signal: controller.signal,
      });
      setData(res.data);
      // Backend (BE-021) returns refreshed_at on the analytics response;
      // fall back to the current time if the field is absent.
      setRefreshedAt(res.data?.refreshed_at ? new Date(res.data.refreshed_at) : new Date());
    } catch (err) {
      if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return;
      toast.error(t('analytics.error') || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, t]);

  /**
   * Trigger a server-side materialized-view refresh (BE-021 admin endpoint),
   * then re-fetch the analytics data.  Admin-only; the backend enforces the role
   * check — this button is surfaced for all users but will receive 403 for non-admins.
   * The UI gracefully surfaces the error so the button doesn't appear broken.
   */
  const handleManualRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await api.post('/admin/analytics/refresh');
      toast.success('Analytics data refreshed');
      // Re-fetch with fresh data
      await fetchAnalytics();
    } catch (err) {
      if (err?.response?.status === 403) {
        toast.error('Only admins can trigger a manual refresh');
      } else {
        toast.error('Refresh failed — please try again');
      }
    } finally {
      setRefreshing(false);
    }
  }, [fetchAnalytics]);

  useEffect(() => {
    fetchAnalytics();
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, [fetchAnalytics]);

  const totalSpent = data?.asset_breakdown?.reduce((sum, item) => sum + parseFloat(item.total || 0), 0) || 0;
  const totalTransactions = data?.asset_breakdown?.reduce((sum, item) => sum + item.count, 0) || 0;
  const noData = totalTransactions === 0;

  const handleExportCSV = async () => {
    if (noData) return;
    setCsvLoading(true);
    try {
      const res = await api.get('/payments/export', {
        params: { format: 'csv', from: range.from, to: range.to },
        responseType: 'blob',
      });
      const blob = new Blob([res.data], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `transactions_${range.from}_to_${range.to}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      toast.error('CSV export failed');
    } finally {
      setCsvLoading(false);
    }
  };

  const handleExportPDF = () => {
    if (noData) return;
    setPdfLoading(true);
    // Small delay so spinner renders before print dialog blocks the thread
    setTimeout(() => {
      window.print();
      setPdfLoading(false);
    }, 50);
  };

  const printDate = new Date().toLocaleDateString();
  const userName = user?.full_name || user?.email || 'User';

  // Build print-table rows from transaction_frequency + asset_breakdown
  const printRows = data?.transaction_frequency?.map((item) => ({
    date: new Date(item.date).toLocaleDateString(),
    description: 'Transaction activity',
    amount: '-',
    status: '-',
    txId: '-',
  })) || [];

  if (loading) {
    return (
      <div className="px-4 py-6 max-w-lg mx-auto flex items-center justify-center min-h-screen" role="status" aria-label="Loading">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <>
      {/* ── Print stylesheet ── */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #print-report, #print-report * { visibility: visible !important; }
          #print-report { position: fixed; inset: 0; padding: 24px; background: white; color: black; }
          #print-report table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 11px; }
          #print-report th, #print-report td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
          #print-report th { background: #f0f0f0; }
          #print-footer { margin-top: 24px; font-size: 10px; color: #555; }
          .no-print { display: none !important; }
        }
      `}</style>

      {/* ── Hidden print report ── */}
      <div id="print-report" style={{ display: 'none' }} aria-hidden="true">
        <h1 style={{ fontSize: 22, fontWeight: 'bold', marginBottom: 4 }}>AfriPay</h1>
        <p style={{ marginBottom: 2 }}><strong>Account:</strong> {userName}</p>
        <p style={{ marginBottom: 2 }}><strong>Date Range:</strong> {range.from} — {range.to}</p>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Transaction ID</th>
            </tr>
          </thead>
          <tbody>
            {printRows.length > 0 ? printRows.map((row, i) => (
              <tr key={i}>
                <td>{row.date}</td>
                <td>{row.description}</td>
                <td>{row.amount}</td>
                <td>{row.status}</td>
                <td>{row.txId}</td>
              </tr>
            )) : (
              <tr><td colSpan={5} style={{ textAlign: 'center' }}>No transaction data in selected range</td></tr>
            )}
          </tbody>
        </table>
        <div id="print-footer">
          Generated by AfriPay on {printDate}. This is not a bank statement.
        </div>
      </div>

      {/* ── Screen UI ── */}
      <div className="px-4 py-6 max-w-lg mx-auto pb-20 no-print">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white mb-6 flex items-center gap-1">
          <ArrowLeft size={18} /> {t('common.back')}
        </button>

        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={24} className="text-primary-500" />
          <h2 className="text-2xl font-bold text-white">{t('analytics.title') || 'Analytics'}</h2>
        </div>

        {/* Data-as-of timestamp + stale indicator + manual refresh */}
        {refreshedAt && (
          <div
            className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 mb-4 border ${
              (Date.now() - refreshedAt.getTime()) / 60000 > STALE_THRESHOLD_MINUTES
                ? 'bg-yellow-500/10 border-yellow-500/30'
                : 'bg-gray-800 border-gray-700'
            }`}
            data-testid="analytics-timestamp-banner"
          >
            <div className="flex items-center gap-2 min-w-0">
              {(Date.now() - refreshedAt.getTime()) / 60000 > STALE_THRESHOLD_MINUTES && (
                <AlertCircle
                  size={15}
                  className="text-yellow-400 shrink-0"
                  aria-label="Stale data"
                  data-testid="analytics-stale-indicator"
                />
              )}
              <p className="text-xs text-gray-400 truncate" data-testid="analytics-refreshed-at">
                Data as of{' '}
                <span className="text-gray-200 font-medium">
                  {refreshedAt.toLocaleString()}
                </span>
                {(Date.now() - refreshedAt.getTime()) / 60000 > STALE_THRESHOLD_MINUTES && (
                  <span className="ml-2 text-yellow-400 font-medium">— data may be stale</span>
                )}
              </p>
            </div>
            <button
              onClick={handleManualRefresh}
              disabled={refreshing || loading}
              className="flex items-center gap-1.5 text-xs text-primary-400 hover:text-primary-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
              title="Trigger a server-side analytics refresh (admin only)"
              data-testid="analytics-refresh-button"
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        )}

        {/* Date range */}
        <div className="flex gap-3 mb-6 items-end">
          <div className="flex-1">
            <label className="text-xs text-gray-400 mb-1 block">From</label>
            <input
              type="date"
              value={range.from}
              max={range.to}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm border border-gray-700 focus:outline-none focus:border-primary-500"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs text-gray-400 mb-1 block">To</label>
            <input
              type="date"
              value={range.to}
              min={range.from}
              max={toDateInput(new Date())}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm border border-gray-700 focus:outline-none focus:border-primary-500"
            />
          </div>
        </div>

        {/* Export buttons */}
        <div className="flex gap-3 mb-6">
          <div title={noData ? 'No transactions in the selected range.' : undefined} className="flex-1">
            <button
              onClick={handleExportCSV}
              disabled={noData || csvLoading}
              className="w-full flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl py-2.5 transition-colors"
            >
              {csvLoading
                ? <Loader2 size={16} className="animate-spin" />
                : <Download size={16} />}
              Export CSV
            </button>
          </div>
          <div title={noData ? 'No transactions in the selected range.' : undefined} className="flex-1">
            <button
              onClick={handleExportPDF}
              disabled={noData || pdfLoading}
              className="w-full flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl py-2.5 transition-colors"
            >
              {pdfLoading
                ? <Loader2 size={16} className="animate-spin" />
                : <FileText size={16} />}
              Export PDF
            </button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="bg-gray-800 rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">{t('analytics.total_spent') || 'Total Spent'}</p>
            <p className="text-white text-lg font-bold">{totalSpent.toFixed(2)}</p>
          </div>
          <div className="bg-gray-800 rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">{t('analytics.transactions') || 'Transactions'}</p>
            <p className="text-white text-lg font-bold">{totalTransactions}</p>
          </div>
        </div>

        {/* Asset Breakdown */}
        {data?.asset_breakdown && data.asset_breakdown.length > 0 && (
          <div className="bg-gray-800 rounded-xl p-4 mb-6">
            <h3 className="text-white font-semibold mb-3">{t('analytics.asset_breakdown') || 'Asset Breakdown'}</h3>
            <div className="space-y-2">
              {data.asset_breakdown.map(item => (
                <div key={item.asset} className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className="text-sm text-gray-300">{item.asset}</p>
                    <div className="w-full bg-gray-700 rounded-full h-2 mt-1">
                      <div
                        className="bg-primary-500 h-2 rounded-full"
                        style={{ width: `${(parseFloat(item.total) / totalSpent) * 100}%` }}
                      />
                    </div>
                  </div>
                  <p className="text-sm text-white font-mono ml-2">{parseFloat(item.total).toFixed(2)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Top Recipients */}
        {data?.top_recipients && data.top_recipients.length > 0 && (
          <div className="bg-gray-800 rounded-xl p-4 mb-6">
            <h3 className="text-white font-semibold mb-3">{t('analytics.top_recipients') || 'Top Recipients'}</h3>
            <div className="space-y-2">
              {data.top_recipients.map((recipient, idx) => (
                <div key={recipient.recipient_address} className="flex items-center justify-between py-2 border-b border-gray-700 last:border-0">
                  <div>
                    <p className="text-xs text-gray-400">#{idx + 1}</p>
                    <p className="text-xs text-gray-300 font-mono">{recipient.recipient_address.slice(0, 16)}...</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-white font-semibold">{parseFloat(recipient.total_amount).toFixed(2)}</p>
                    <p className="text-xs text-gray-400">{recipient.count} {t('analytics.transactions_label') || 'txs'}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Monthly Activity */}
        {data?.transaction_frequency && data.transaction_frequency.length > 0 && (
          <div className="bg-gray-800 rounded-xl p-4">
            <h3 className="text-white font-semibold mb-3">{t('analytics.monthly_activity') || 'Monthly Activity'}</h3>
            <div className="space-y-2">
              {data.transaction_frequency.slice(0, 10).map(item => (
                <div key={item.date} className="flex items-center justify-between">
                  <p className="text-xs text-gray-400">{new Date(item.date).toLocaleDateString()}</p>
                  <div className="flex items-center gap-2">
                    <div className="w-24 bg-gray-700 rounded h-1.5">
                      <div
                        className="bg-primary-500 h-1.5 rounded"
                        style={{ width: `${Math.min((item.count / 10) * 100, 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-300 w-6 text-right">{item.count}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {(!data || (data.asset_breakdown?.length === 0 && data.top_recipients?.length === 0)) && (
          <div className="text-center py-12">
            <p className="text-gray-400">{t('analytics.no_data') || 'No analytics data available'}</p>
          </div>
        )}
      </div>
    </>
  );
}
