import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import toast from 'react-hot-toast';

export default function Escrow() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('create');
  const [escrows, setEscrows] = useState([]);
  const [loading, setLoading] = useState(false);

  // Create escrow form
  const [createForm, setCreateForm] = useState({
    agent_wallet: '',
    recipient_wallet: '',
    amount: '',
    asset: 'USDC',
  });

  // Confirm/Cancel escrow
  const [selectedEscrow, setSelectedEscrow] = useState(null);

  // Partial release modal (issue #657)
  const [partialEscrow, setPartialEscrow] = useState(null);
  const [partialAmount, setPartialAmount] = useState('');
  const [partialLoading, setPartialLoading] = useState(false);

  const feeBps = partialEscrow?.fee_bps ?? 250; // platform fee from escrow, fallback 2.5%

  const remainingBalance = (escrow) =>
    parseFloat(escrow.amount) - parseFloat(escrow.released_amount || 0);

  const openPartialRelease = (escrow) => {
    setPartialEscrow(escrow);
    setPartialAmount(String(remainingBalance(escrow)));
  };

  const closePartialRelease = () => {
    setPartialEscrow(null);
    setPartialAmount('');
  };

  useEffect(() => {
    if (activeTab === 'list') {
      fetchEscrows();
    }
  }, [activeTab]);

  const fetchEscrows = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/escrow');
      setEscrows(data.escrows || []);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to fetch escrows');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateEscrow = async (e) => {
    e.preventDefault();
    if (!createForm.agent_wallet || !createForm.recipient_wallet || !createForm.amount) {
      toast.error('Please fill in all fields');
      return;
    }

    // Validate Stellar address format (56 chars, starts with 'G')
    const validateWallet = (addr, label) => {
      const trimmed = addr.trim();
      if (!trimmed.startsWith('G')) {
        toast.error(`${label} must be a valid Stellar address (starts with G)`);
        return false;
      }
      if (trimmed.length !== 56) {
        toast.error(`${label} must be 56 characters (got ${trimmed.length})`);
        return false;
      }
      if (!/^[A-Z0-9]+$/.test(trimmed)) {
        toast.error(`${label} contains invalid characters`);
        return false;
      }
      return true;
    };

    if (!validateWallet(createForm.agent_wallet, 'Agent wallet')) return;
    if (!validateWallet(createForm.recipient_wallet, 'Recipient wallet')) return;

    setLoading(true);
    try {
      const { data } = await api.post('/escrow/create', createForm);
      toast.success('Escrow created successfully');
      setCreateForm({ agent_wallet: '', recipient_wallet: '', amount: '', asset: 'USDC' });
      setActiveTab('list');
      fetchEscrows();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create escrow');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmEscrow = async (escrowId, escrow) => {
    const remaining = remainingBalance(escrow);
    if (!window.confirm(
      `Are you sure you want to fully release the remaining ${remaining} ${escrow.asset}? This action cannot be undone.`
    )) return;

    setLoading(true);
    try {
      await api.post(`/escrow/${escrowId}/confirm`);
      toast.success('Escrow confirmed');
      fetchEscrows();
      setSelectedEscrow(null);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to confirm escrow');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelEscrow = async (escrowId) => {
    if (!window.confirm('Are you sure you want to cancel this escrow?')) return;

    setLoading(true);
    try {
      await api.post(`/escrow/${escrowId}/cancel`);
      toast.success('Escrow cancelled');
      fetchEscrows();
      setSelectedEscrow(null);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to cancel escrow');
    } finally {
      setLoading(false);
    }
  };

  const handlePartialRelease = async (e) => {
    e.preventDefault();
    if (!partialEscrow) return;

    const amount = parseFloat(partialAmount);
    const remaining = remainingBalance(partialEscrow);

    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter an amount greater than 0');
      return;
    }
    if (amount > remaining) {
      toast.error('Amount cannot exceed the escrowed balance');
      return;
    }

    setPartialLoading(true);
    try {
      const { data } = await api.post(`/contracts/escrow/${partialEscrow.id}/partial-release`, {
        amount,
      });
      toast.success('Partial release successful');
      // Update the affected row in place without a full reload.
      setEscrows((prev) =>
        prev.map((esc) =>
          esc.id === partialEscrow.id ? { ...esc, ...(data.escrow || {}) } : esc
        )
      );
      closePartialRelease();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to release escrow');
    } finally {
      setPartialLoading(false);
    }
  };

  const previewAmount = parseFloat(partialAmount) || 0;
  const previewFee = (previewAmount * feeBps) / 10000;
  const previewNet = previewAmount - previewFee;
  const partialError =
    partialEscrow && previewAmount > 0 && previewAmount > remainingBalance(partialEscrow)
      ? 'Amount cannot exceed the escrowed balance'
      : partialEscrow && partialAmount !== '' && previewAmount <= 0
      ? 'Amount must be greater than 0'
      : '';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-4 md:p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-6">Agent Escrow</h1>

        {/* Tabs */}
        <div className="flex gap-4 mb-6 border-b border-gray-200 dark:border-gray-800">
          <button
            onClick={() => setActiveTab('create')}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === 'create'
                ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            Create Escrow
          </button>
          <button
            onClick={() => setActiveTab('list')}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === 'list'
                ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            My Escrows
          </button>
        </div>

        {/* Create Escrow Tab */}
        {activeTab === 'create' && (
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow p-6">
            <form onSubmit={handleCreateEscrow} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Agent Wallet Address
                </label>
                <input
                  type="text"
                  value={createForm.agent_wallet}
                  onChange={(e) => setCreateForm({ ...createForm, agent_wallet: e.target.value })}
                  placeholder="G..."
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Recipient Wallet Address
                </label>
                <input
                  type="text"
                  value={createForm.recipient_wallet}
                  onChange={(e) => setCreateForm({ ...createForm, recipient_wallet: e.target.value })}
                  placeholder="G..."
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Amount
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={createForm.amount}
                    onChange={(e) => setCreateForm({ ...createForm, amount: e.target.value })}
                    placeholder="0.00"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Asset
                  </label>
                  <select
                    value={createForm.asset}
                    onChange={(e) => setCreateForm({ ...createForm, asset: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    <option value="USDC">USDC</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 rounded-lg transition-colors"
              >
                {loading ? 'Creating...' : 'Create Escrow'}
              </button>
            </form>
          </div>
        )}

        {/* List Escrows Tab */}
        {activeTab === 'list' && (
          <div className="space-y-4">
            {loading && !escrows.length ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">Loading...</div>
            ) : escrows.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">No escrows found</div>
            ) : (
              escrows.map((escrow) => (
                <div
                  key={escrow.id}
                  className="bg-white dark:bg-gray-900 rounded-lg shadow p-4 cursor-pointer hover:shadow-lg transition-shadow"
                  onClick={() => setSelectedEscrow(selectedEscrow?.id === escrow.id ? null : escrow)}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">
                        {escrow.amount} {escrow.asset}
                      </p>
                      {parseFloat(escrow.released_amount || 0) > 0 && (
                        <p className="text-sm text-blue-600 dark:text-blue-400">
                          Remaining: {remainingBalance(escrow)} {escrow.asset}
                        </p>
                      )}
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Status: <span className="font-medium capitalize">{escrow.status}</span>
                      </p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      escrow.status === 'pending'
                        ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200'
                        : escrow.status === 'completed'
                        ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                        : 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200'
                    }`}>
                      {escrow.status}
                    </span>
                  </div>

                  {selectedEscrow?.id === escrow.id && (
                    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-2">
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        <span className="font-medium">Agent:</span> {escrow.agent_wallet.slice(0, 10)}...
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        <span className="font-medium">Recipient:</span> {escrow.recipient_wallet.slice(0, 10)}...
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        <span className="font-medium">Created:</span> {new Date(escrow.created_at).toLocaleDateString()}
                      </p>

                      {escrow.status === 'pending' && (
                        <div className="flex flex-wrap gap-2 mt-4">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleConfirmEscrow(escrow.id, escrow);
                            }}
                            disabled={loading}
                            className="flex-1 min-w-[120px] bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-medium py-2 rounded-lg transition-colors"
                          >
                            Full Release
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openPartialRelease(escrow);
                            }}
                            disabled={loading}
                            className="flex-1 min-w-[120px] bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 rounded-lg transition-colors"
                          >
                            Partial Release
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCancelEscrow(escrow.id);
                            }}
                            disabled={loading}
                            className="flex-1 min-w-[120px] bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white font-medium py-2 rounded-lg transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Partial Release Modal (issue #657) */}
      {partialEscrow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Partial Release</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Escrowed balance: {remainingBalance(partialEscrow)} {partialEscrow.asset}
            </p>

            <form onSubmit={handlePartialRelease} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Amount to release
                </label>
                <input
                  type="number"
                  step="0.0000001"
                  min="0"
                  max={remainingBalance(partialEscrow)}
                  value={partialAmount}
                  onChange={(e) => setPartialAmount(e.target.value)}
                  autoFocus
                  className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none ${
                    partialError ? 'border-red-500' : 'border-gray-300 dark:border-gray-700'
                  }`}
                />
                {partialError && <p className="text-xs text-red-500 mt-1">{partialError}</p>}
              </div>

              {/* Preview */}
              <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-3 space-y-1 text-sm">
                <div className="flex justify-between text-gray-600 dark:text-gray-400">
                  <span>Amount to release</span>
                  <span className="text-gray-900 dark:text-white">{previewAmount.toFixed(7)} {partialEscrow.asset}</span>
                </div>
                <div className="flex justify-between text-gray-600 dark:text-gray-400">
                  <span>Platform fee ({(feeBps / 100).toFixed(2)}%)</span>
                  <span className="text-red-500">-{previewFee.toFixed(7)} {partialEscrow.asset}</span>
                </div>
                <div className="flex justify-between font-medium border-t border-gray-200 dark:border-gray-700 pt-1 mt-1">
                  <span className="text-gray-700 dark:text-gray-300">Net to agent</span>
                  <span className="text-green-600 dark:text-green-400">{previewNet.toFixed(7)} {partialEscrow.asset}</span>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={closePartialRelease}
                  className="flex-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-white font-medium py-2 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={partialLoading || !!partialError || previewAmount <= 0}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 rounded-lg transition-colors"
                >
                  {partialLoading ? 'Releasing…' : 'Confirm Release'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
