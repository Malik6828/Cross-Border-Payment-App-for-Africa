import React, { useEffect, useState } from 'react';
import { Activity, Users, DollarSign, TrendingUp, Server, BarChart3 } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line,
} from 'recharts';
import api from '../utils/api';
import toast from 'react-hot-toast';

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

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const chartData = dailyStats.map((d) => ({
    date: d.date,
    transactions: parseInt(d.tx_count, 10),
    volume: parseFloat(d.volume),
    fees: parseFloat(d.fees),
  }));

  return (
    <div className="px-4 py-6 max-w-6xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Admin Dashboard</h2>

      {/* Platform Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-500/10 rounded-lg flex items-center justify-center text-primary-500">
              <Users size={20} />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total Users</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats?.total_users || 0}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-500/10 rounded-lg flex items-center justify-center text-primary-500">
              <Activity size={20} />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Transactions</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats?.total_transactions || 0}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-500/10 rounded-lg flex items-center justify-center text-primary-500">
              <DollarSign size={20} />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total Volume</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{parseFloat(stats?.total_volume || 0).toFixed(2)}</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-500/10 rounded-lg flex items-center justify-center text-primary-500">
              <TrendingUp size={20} />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total Fees</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{parseFloat(stats?.total_fees || 0).toFixed(2)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Daily Analytics Chart */}
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <BarChart3 size={20} className="text-primary-500" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Daily Analytics (Last 30 Days)</h3>
          </div>
          <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
            {['volume', 'transactions', 'fees'].map((mode) => (
              <button
                key={mode}
                onClick={() => setChartMode(mode)}
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

        <div className="h-72">
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
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={20} className="text-primary-500" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Volume Trend</h3>
        </div>
        <div className="h-72">
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
      <div className="bg-gradient-to-br from-primary-600 to-primary-700 rounded-2xl p-6 shadow-lg">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center text-white">
            <Server size={20} />
          </div>
          <h3 className="text-xl font-bold text-white">Stellar Network Statistics</h3>
        </div>

        {stellarStats ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="bg-white/10 rounded-lg p-4">
              <p className="text-primary-100 text-sm mb-1">Latest Ledger</p>
              <p className="text-2xl font-bold text-white">{stellarStats.latestLedger?.toLocaleString()}</p>
            </div>

            <div className="bg-white/10 rounded-lg p-4">
              <p className="text-primary-100 text-sm mb-1">Base Fee (stroops)</p>
              <p className="text-2xl font-bold text-white">{stellarStats.baseFee}</p>
            </div>

            <div className="bg-white/10 rounded-lg p-4">
              <p className="text-primary-100 text-sm mb-1">Max Tx Set Size</p>
              <p className="text-2xl font-bold text-white">{stellarStats.maxFee}</p>
            </div>

            <div className="bg-white/10 rounded-lg p-4">
              <p className="text-primary-100 text-sm mb-1">Transactions</p>
              <p className="text-2xl font-bold text-white">{stellarStats.transactionCount}</p>
            </div>

            <div className="bg-white/10 rounded-lg p-4">
              <p className="text-primary-100 text-sm mb-1">Operations</p>
              <p className="text-2xl font-bold text-white">{stellarStats.operationCount}</p>
            </div>

            <div className="bg-white/10 rounded-lg p-4">
              <p className="text-primary-100 text-sm mb-1">Closed At</p>
              <p className="text-sm font-medium text-white">
                {new Intl.DateTimeFormat('en', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone,
                }).format(new Date(stellarStats.closedAt))}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-primary-100">Loading network stats...</p>
        )}
      </div>
    </div>
  );
}
