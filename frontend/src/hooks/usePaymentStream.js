import { useState, useEffect, useRef, useCallback } from 'react';
import * as StellarSdk from '@stellar/stellar-sdk';

const HORIZON_URL =
  process.env.REACT_APP_STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

/**
 * Hook to stream real-time payment notifications from Stellar Horizon.
 * Tracks the last seen cursor so reconnections resume from where they left off.
 *
 * @param {string} publicKey - The account public key to monitor
 * @param {Function} onPayment - Callback when a new payment is detected
 * @returns {{ isConnected: boolean, isReconnecting: boolean, error: string|null, reconnect: Function, disconnect: Function }}
 */
export function usePaymentStream(publicKey, onPayment) {
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [error, setError] = useState(null);

  const streamRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const lastCursorRef = useRef('now');
  const onPaymentRef = useRef(onPayment);
  const mountedRef = useRef(true);

  // Keep callback ref fresh without triggering reconnects
  useEffect(() => {
    onPaymentRef.current = onPayment;
  }, [onPayment]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const closeStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current();
      streamRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    closeStream();
    try {
      const server = new StellarSdk.Horizon.Server(HORIZON_URL);
      streamRef.current = server
        .payments()
        .forAccount(publicKey)
        .cursor(lastCursorRef.current)
        .stream({
          onmessage: (payment) => {
            if (!mountedRef.current) return;
            if (payment.paging_token) lastCursorRef.current = payment.paging_token;
            reconnectAttemptsRef.current = 0;
            setIsConnected(true);
            setIsReconnecting(false);
            setError(null);
            if (onPaymentRef.current) {
              onPaymentRef.current({
                id: payment.id,
                type: payment.type,
                from: payment.from,
                to: payment.to,
                amount: payment.amount,
                asset: payment.asset_type === 'native' ? 'XLM' : payment.asset_code,
                createdAt: payment.created_at,
                transactionHash: payment.transaction_hash,
              });
            }
          },
          onerror: (err) => {
            if (!mountedRef.current) return;
            // eslint-disable-next-line no-console
            console.warn('Payment stream disconnected:', err?.message || err);
            setIsConnected(false);
            const attempt = reconnectAttemptsRef.current;
            if (attempt < MAX_RECONNECT_ATTEMPTS) {
              const delay = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
              reconnectAttemptsRef.current += 1;
              setIsReconnecting(true);
              setError(
                `Stream disconnected. Reconnecting in ${Math.round(delay / 1000)}s… (attempt ${attempt + 1})`,
              );
              reconnectTimeoutRef.current = setTimeout(connect, delay);
            } else {
              setIsReconnecting(false);
              setError('Stream disconnected. Max reconnect attempts reached.');
            }
          },
          onclose: () => {
            if (mountedRef.current) setIsConnected(false);
          },
        });
    } catch (err) {
      if (!mountedRef.current) return;
      // eslint-disable-next-line no-console
      console.error('Failed to open payment stream:', err);
      setIsConnected(false);
      setError(err.message || 'Failed to connect');
    }
  }, [publicKey, closeStream]); // eslint-disable-line react-hooks/exhaustive-deps

  const disconnect = useCallback(() => {
    clearReconnectTimer();
    closeStream();
    if (mountedRef.current) {
      setIsConnected(false);
      setIsReconnecting(false);
    }
  }, [clearReconnectTimer, closeStream]);

  const reconnect = useCallback(() => {
    clearReconnectTimer();
    reconnectAttemptsRef.current = 0;
    connect();
  }, [clearReconnectTimer, connect]);

  useEffect(() => {
    mountedRef.current = true;
    if (!publicKey) return undefined;
    lastCursorRef.current = 'now';
    reconnectAttemptsRef.current = 0;
    connect();
    return () => {
      mountedRef.current = false;
      clearReconnectTimer();
      closeStream();
    };
  }, [publicKey, connect, clearReconnectTimer, closeStream]);

  // Resume stream when the browser comes back online
  useEffect(() => {
    const handleOnline = () => { if (publicKey && !isConnected) reconnect(); };
    const handleOffline = () => { if (mountedRef.current) setIsConnected(false); };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [publicKey, isConnected, reconnect]);

  return { isConnected, isReconnecting, error, reconnect, disconnect };
}

export default usePaymentStream;
