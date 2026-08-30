/**
 * OfflineBanner
 *
 * Displays a persistent banner when the device is offline.
 * Shows queued payment count, a dropdown list of queued transactions,
 * and allows the user to cancel individual queued items.
 *
 * When connectivity is restored, automatically retries all queued
 * payments in order and notifies on success / persistent failure.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { WifiOff, Wifi, Clock, ChevronDown, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  getQueueCount,
  getQueuedPayments,
  removeQueuedPayment,
} from '../utils/offlineDB';
import api from '../utils/api';

export default function OfflineBanner({ onPaymentSynced }) {
  const { isOnline, wasOffline } = useOnlineStatus({ onPaymentSynced });
  const [showBackOnline, setShowBackOnline] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [queuedItems, setQueuedItems] = useState([]);
  const [showQueue, setShowQueue] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const refreshQueue = useCallback(async () => {
    try {
      const [count, items] = await Promise.all([getQueueCount(), getQueuedPayments()]);
      setQueueCount(count);
      setQueuedItems(items);
    } catch {
      setQueueCount(0);
      setQueuedItems([]);
    }
  }, []);

  // Refresh queue count whenever online status changes
  useEffect(() => {
    refreshQueue();
  }, [isOnline, refreshQueue]);

  // Auto-submit queued payments when coming back online
  useEffect(() => {
    if (!isOnline || !wasOffline) return;

    const syncQueue = async () => {
      const items = await getQueuedPayments();
      if (items.length === 0) return;

      setSyncing(true);
      for (const item of items) {
        try {
          await api.post('/payments/send', item.payload);
          await removeQueuedPayment(item.id);
          toast.success(
            `Payment of ${item.payload.amount} ${item.payload.asset || 'XLM'} sent successfully.`,
            { duration: 4000 }
          );
          onPaymentSynced?.();
        } catch (err) {
          // Move to failed state — notify persistently
          toast.error(
            `Failed to send queued payment (${item.payload.amount} ${item.payload.asset || 'XLM'}): ${
              err.response?.data?.error || err.message || 'Unknown error'
            }`,
            { duration: 0, id: `queue-fail-${item.id}` }
          );
        }
      }
      setSyncing(false);
      refreshQueue();
    };

    syncQueue();
  }, [isOnline]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show the "back online" notice for 4 seconds after reconnecting
  useEffect(() => {
    if (isOnline && wasOffline) {
      setShowBackOnline(true);
      const t = setTimeout(() => setShowBackOnline(false), 4000);
      return () => clearTimeout(t);
    }
  }, [isOnline, wasOffline]);

  const handleCancel = async (id) => {
    await removeQueuedPayment(id);
    refreshQueue();
    toast('Queued payment cancelled.', { icon: '🗑️' });
  };

  if (!isOnline) {
    return (
      <div className="relative">
        <div
          role="status"
          aria-live="assertive"
          className="bg-red-600 text-white text-xs font-semibold py-2 px-4 flex items-center justify-center gap-2"
        >
          <WifiOff size={14} aria-hidden="true" />
          <span>You're offline — showing cached data</span>
          {queueCount > 0 && (
            <button
              type="button"
              onClick={() => setShowQueue(v => !v)}
              className="flex items-center gap-1 ml-2 bg-red-700 hover:bg-red-800 rounded-full px-2 py-0.5 transition-colors"
              aria-expanded={showQueue}
              aria-label={`${queueCount} payment${queueCount !== 1 ? 's' : ''} queued — click to view`}
            >
              <Clock size={11} aria-hidden="true" />
              {queueCount} payment{queueCount !== 1 ? 's' : ''} queued
              <ChevronDown
                size={11}
                className={`transition-transform ${showQueue ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>
          )}
        </div>

        {/* Queue dropdown */}
        {showQueue && queuedItems.length > 0 && (
          <div
            role="region"
            aria-label="Pending payment queue"
            className="absolute top-full left-0 right-0 z-50 bg-gray-900 border border-red-600/40 shadow-xl max-h-64 overflow-y-auto"
          >
            <p className="px-4 py-2 text-xs text-gray-400 font-semibold uppercase tracking-wide border-b border-gray-800">
              Pending Queue
            </p>
            {queuedItems.map(item => (
              <div
                key={item.id}
                className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800 last:border-0"
              >
                <div className="text-xs text-gray-300">
                  <span className="font-semibold text-white">
                    {item.payload.amount} {item.payload.asset || 'XLM'}
                  </span>
                  {item.payload.recipient_address && (
                    <span className="ml-1 text-gray-500 font-mono">
                      → {item.payload.recipient_address.slice(0, 8)}…
                    </span>
                  )}
                  <span className="ml-2 text-gray-600">
                    {new Date(item.createdAt).toLocaleTimeString()}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleCancel(item.id)}
                  className="ml-3 text-gray-400 hover:text-red-400 transition-colors shrink-0"
                  aria-label="Cancel this queued payment"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (showBackOnline) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="bg-primary-500 text-white text-xs font-semibold py-2 px-4 flex items-center justify-center gap-2"
      >
        <Wifi size={14} aria-hidden="true" />
        <span>
          {syncing
            ? `Back online — syncing ${queueCount} queued payment${queueCount !== 1 ? 's' : ''}…`
            : 'Back online — all caught up'}
        </span>
      </div>
    );
  }

  return null;
}
