import React, { useEffect, useState } from 'react';
import { Activity, Users, DollarSign, TrendingUp, Server, BarChart3, ShieldAlert, CheckCircle, XCircle } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line,
} from 'recharts';
import api from '../utils/api';
import toast from 'react-hot-toast';
import ConfirmModal from '../components/ConfirmModal';

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

function formatDateLocal(dateStr) {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    timeZone,
  }).format(new Date(dateStr + 'T00:00:00'));
}

function formatDateFull(dateStr) {
  return new Intl.DateTimeFormat('en', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  }).format(new Date(dateStr + 'T00:00:00'));
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 shadow-xl">
      <p className="text-gray-400 text-xs mb-1">{formatDateFull(label)}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-sm font-semibold" style={{ color: entry.color }}>
          {entry.name}: {typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}
        </p>
      ))}
    </div>
  );
}

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [dailyStats, setDailyStats] = useState([]);
  const [stellarStats, setStellarStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [chartMode, setChartMode] = useState('volume');

  // ── Bulk user actions state ───────────────────────────────────────────────
  /** Current filter for bulk user selection. */
  const [bulkFilter, setBulkFilter] = useState('unverified');
  /** Users matching the current filter — populated before showing the confirm modal. */
  const [bulkPreviewUsers, setBulkPreviewUsers] = useState([]);
  /** Which action has been staged for confirmation. */
  const [bulkAction, setBulkAction] = useState(null); // 'suspend' | 'verify' | null
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkPreviewLoading, setBulkPreviewLoading] = useState(false);
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    Promise.all([
      api.get('/admin/stats'),
      api.get('/admin/daily-stats?days=30'),
      api.get('/admin/stellar-stats'),
    ]).then(([statsRes, dailyRes, stellarRes]) => {
      setStats(statsRes.data);
      setDailyStats(dailyRes.data);
      setStellarStats(stellarRes.data);
    }).catch(() => toast.error('Failed to load admin stats'))
      .finally(() => setLoading(false));
  }, []);

  /**
   * Fetch a preview of the users that will be affected by the chosen bulk action
   * and filter, then open the confirmation modal.  This ensures the admin reviews
   * the exact list (or a representative sample + total count) before submitting.
   */
  const handleStageBulkAction = async (action) => {
    setBulkPreviewLoading(true);
    try {
      const res = await api.get(`/admin/users?filter=${encodeURIComponent(bulkFilter)}&limit=50`);
      const users = res.data?.users ?? res.data ?? [];
      setBulkPreviewUsers(users);
      setBulkAction(action);
    } catch {
      toast.error('Failed to load affected users. Please try again.');
    } finally {
      setBulkPreviewLoading(false);
    }
  };

  /** Execute the confirmed bulk action. */
  const handleConfirmBulkAction = async () => {
    setBulkLoading(true);
    try {
      await api.post('/admin/users/bulk', {
        action: bulkAction,
        filter: bulkFilter,
        user_ids: bulkPreviewUsers.map((u) => u.id),
      });
      toast.success(
        `Bulk ${bulkAction} applied to ${bulkPreviewUsers.length} user${bulkPreviewUsers.length !== 1 ? 's' : ''}`
      );
      setBulkAction(null);
      setBulkPreviewUsers([]);
    } catch {
      toast.error('Bulk action failed. Please try again.');
    } finally {
      setBulkLoading(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64" role="status" aria-live="polite" aria-label="Loading admin dashboard">
      <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" aria-hidden="true" />
      <span className="sr-only">Loading admin dashboard…</span>
    </div>
  );

  const chartData = dailyStats.map((d) => ({
    date: d.date,
    transactions: parseInt(d.tx_count, 10),
    volume: parseFloat(d.volume),
    fees: parseFloat(d.fees),
  }));

  return (
    <div className="px-4 py-6 max-w-6xl mx-auto space-y-6" role="main" aria-label="Admin dashboard">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Admin Dashboard</h2>

      {/* Platform Stats */}
      <div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
        role="group"
        aria-label="Platform statistics"
        aria-live="polite"
      >
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-500/10 rounded-lg flex items-center justify-center text-primary-500" aria-hidden="true">
              <Users size={20} />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400" id="stat-total-users-label">Total Users</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white" aria-labelledby="stat-total-users-label">{stats?.total_users || 0}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-500/10 rounded-lg flex items-center justify-center text-primary-500" aria-hidden="true">
              <Activity size={20} />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400" id="stat-transactions-label">Transactions</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white" aria-labelledby="stat-transactions-label">{stats?.total_transactions || 0}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-500/10 rounded-lg flex items-center justify-center text-primary-500" aria-hidden="true">
              <DollarSign size={20} />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400" id="stat-volume-label">Total Volume</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white" aria-labelledby="stat-volume-label">{parseFloat(stats?.total_volume || 0).toFixed(2)}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-500/10 rounded-lg flex items-center justify-center text-primary-500" aria-hidden="true">
              <TrendingUp size={20} />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400" id="stat-fees-label">Total Fees</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white" aria-labelledby="stat-fees-label">{parseFloat(stats?.total_fees || 0).toFixed(2)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Daily Analytics Chart */}
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5 shadow-sm" role="region" aria-labelledby="daily-analytics-heading">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <BarChart3 size={20} className="text-primary-500" aria-hidden="true" />
            <h3 id="daily-analytics-heading" className="text-lg font-semibold text-gray-900 dark:text-white">Daily Analytics (Last 30 Days)</h3>
          </div>
          <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1" role="group" aria-label="Chart metric selector">
            {['volume', 'transactions', 'fees'].map((mode) => (
              <button
                key={mode}
                onClick={() => setChartMode(mode)}
                aria-pressed={chartMode === mode}
                aria-label={`Show ${mode} chart`}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  chartMode === mode
                    ? 'bg-primary-500 text-white'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="h-72" role="img" aria-label={`Bar chart of daily ${chartMode} for the last 30 days`}>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#9CA3AF', fontSize: 11 }}
                  tickFormatter={formatDateLocal}
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                <Tooltip content={<ChartTooltip />} />
                <Bar
                  dataKey={chartMode}
                  name={chartMode.charAt(0).toUpperCase() + chartMode.slice(1)}
                  fill={chartMode === 'volume' ? '#10B981' : chartMode === 'transactions' ? '#6366F1' : '#F59E0B'}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-gray-500 dark:text-gray-400 text-sm">No transaction data available.</p>
            </div>
          )}
        </div>
      </div>

      {/* Daily Transaction Volume Trend */}
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5 shadow-sm" role="region" aria-labelledby="volume-trend-heading">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={20} className="text-primary-500" aria-hidden="true" />
          <h3 id="volume-trend-heading" className="text-lg font-semibold text-gray-900 dark:text-white">Volume Trend</h3>
        </div>
        <div className="h-72" role="img" aria-label="Line chart of daily volume trend for the last 30 days">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#9CA3AF', fontSize: 11 }}
                  tickFormatter={formatDateLocal}
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                <Tooltip content={<ChartTooltip />} />
                <Line type="monotone" dataKey="volume" name="Volume" stroke="#10B981" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-gray-500 dark:text-gray-400 text-sm">No transaction data available.</p>
            </div>
          )}
        </div>
      </div>

      {/* Stellar Network Stats */}
      <div className="bg-gradient-to-br from-primary-600 to-primary-700 rounded-2xl p-6 shadow-lg" role="region" aria-labelledby="stellar-stats-heading">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center text-white" aria-hidden="true">
            <Server size={20} />
          </div>
          <h3 id="stellar-stats-heading" className="text-xl font-bold text-white">Stellar Network Statistics</h3>
        </div>

        {stellarStats ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4" aria-live="polite">
            <div className="bg-white/10 rounded-lg p-4">
              <p className="text-primary-100 text-sm mb-1" id="stat-latest-ledger-label">Latest Ledger</p>
              <p className="text-2xl font-bold text-white" aria-labelledby="stat-latest-ledger-label">{stellarStats.latestLedger?.toLocaleString()}</p>
            </div>

            <div className="bg-white/10 rounded-lg p-4">
              <p className="text-primary-100 text-sm mb-1" id="stat-base-fee-label">Base Fee (stroops)</p>
              <p className="text-2xl font-bold text-white" aria-labelledby="stat-base-fee-label">{stellarStats.baseFee}</p>
            </div>

            <div className="bg-white/10 rounded-lg p-4">
              <p className="text-primary-100 text-sm mb-1" id="stat-max-tx-label">Max Tx Set Size</p>
              <p className="text-2xl font-bold text-white" aria-labelledby="stat-max-tx-label">{stellarStats.maxFee}</p>
            </div>

            <div className="bg-white/10 rounded-lg p-4">
              <p className="text-primary-100 text-sm mb-1" id="stat-tx-count-label">Transactions</p>
              <p className="text-2xl font-bold text-white" aria-labelledby="stat-tx-count-label">{stellarStats.transactionCount}</p>
            </div>

            <div className="bg-white/10 rounded-lg p-4">
              <p className="text-primary-100 text-sm mb-1" id="stat-op-count-label">Operations</p>
              <p className="text-2xl font-bold text-white" aria-labelledby="stat-op-count-label">{stellarStats.operationCount}</p>
            </div>

            <div className="bg-white/10 rounded-lg p-4">
              <p className="text-primary-100 text-sm mb-1" id="stat-closed-at-label">Closed At</p>
              <p className="text-sm font-medium text-white" aria-labelledby="stat-closed-at-label">
                {new Intl.DateTimeFormat('en', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone,
                }).format(new Date(stellarStats.closedAt))}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-primary-100" role="status" aria-live="polite">Loading network stats...</p>
        )}
      </div>

      {/* ── Bulk User Actions ─────────────────────────────────────────────── */}
      <div
        className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5 shadow-sm"
        role="region"
        aria-labelledby="bulk-actions-heading"
        data-testid="bulk-actions-section"
      >
        <div className="flex items-center gap-2 mb-4">
          <ShieldAlert size={20} className="text-red-500" aria-hidden="true" />
          <h3 id="bulk-actions-heading" className="text-lg font-semibold text-gray-900 dark:text-white">
            Bulk User Actions
          </h3>
        </div>

        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Apply an action to all users matching the selected filter. You will be shown
          the exact list of affected accounts before anything is submitted.
        </p>

        {/* Filter selector */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="flex-1">
            <label
              htmlFor="bulk-filter"
              className="block text-xs text-gray-500 dark:text-gray-400 mb-1"
            >
              User filter
            </label>
            <select
              id="bulk-filter"
              value={bulkFilter}
              onChange={(e) => setBulkFilter(e.target.value)}
              className="w-full bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-primary-500"
              data-testid="bulk-filter-select"
            >
              <option value="unverified">Unverified users (KYC pending)</option>
              <option value="inactive_30d">Inactive for 30+ days</option>
              <option value="inactive_90d">Inactive for 90+ days</option>
              <option value="suspended">Currently suspended</option>
            </select>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => handleStageBulkAction('suspend')}
            disabled={bulkPreviewLoading}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            data-testid="bulk-suspend-button"
          >
            <XCircle size={15} />
            {bulkPreviewLoading && bulkAction === null ? 'Loading…' : 'Suspend Matching Users'}
          </button>
          <button
            onClick={() => handleStageBulkAction('verify')}
            disabled={bulkPreviewLoading}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            data-testid="bulk-verify-button"
          >
            <CheckCircle size={15} />
            {bulkPreviewLoading && bulkAction === null ? 'Loading…' : 'Verify Matching Users'}
          </button>
        </div>
      </div>

      {/* Bulk action confirmation modal — shows reviewable list of affected accounts */}
      <ConfirmModal
        isOpen={!!bulkAction}
        onClose={() => { setBulkAction(null); setBulkPreviewUsers([]); }}
        onConfirm={handleConfirmBulkAction}
        title={`Confirm bulk ${bulkAction} (${bulkPreviewUsers.length} user${bulkPreviewUsers.length !== 1 ? 's' : ''})`}
        message={`You are about to ${bulkAction} the ${bulkPreviewUsers.length} account${bulkPreviewUsers.length !== 1 ? 's' : ''} listed below. This action cannot be automatically undone.`}
        confirmLabel={`${bulkAction === 'suspend' ? 'Suspend' : 'Verify'} ${bulkPreviewUsers.length} User${bulkPreviewUsers.length !== 1 ? 's' : ''}`}
        confirmVariant="danger"
        loading={bulkLoading}
        data-testid="bulk-confirm-modal"
      >
        {/* Scrollable, reviewable list of affected users */}
        {bulkPreviewUsers.length > 0 && (
          <div
            className="mt-4 max-h-48 overflow-y-auto rounded-lg border border-gray-700 bg-gray-800"
            aria-label="Affected user accounts"
            data-testid="bulk-preview-list"
          >
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-700 text-gray-300">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">#</th>
                  <th className="px-3 py-2 text-left font-medium">Email</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {bulkPreviewUsers.map((u, idx) => (
                  <tr key={u.id} className="text-gray-300">
                    <td className="px-3 py-2 text-gray-500">{idx + 1}</td>
                    <td className="px-3 py-2 font-mono">{u.email}</td>
                    <td className="px-3 py-2">{u.kyc_status || u.status || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {bulkPreviewUsers.length === 0 && (
          <p className="mt-3 text-xs text-gray-500 text-center">
            No users match the selected filter. The action will have no effect.
          </p>
        )}
      </ConfirmModal>
    </div>
  );
}
