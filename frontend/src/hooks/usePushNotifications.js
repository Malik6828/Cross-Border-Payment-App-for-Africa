import { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';

const VAPID_PUBLIC_KEY = process.env.REACT_APP_VAPID_PUBLIC_KEY;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function usePushNotifications() {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );

  useEffect(() => {
    setSupported('serviceWorker' in navigator && 'PushManager' in window);
  }, []);

  // Register SW and check existing subscription on mount (no auto-subscribe)
  useEffect(() => {
    if (!supported) return;
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribed(!!sub))
      .catch(() => {});
  }, [supported]);

  const shouldShowPrompt = useCallback(() => {
    if (permissionStatus !== 'default') return false;
    const deferred = localStorage.getItem('notifications_deferred');
    if (!deferred) return true;
    return Date.now() - parseInt(deferred, 10) > SEVEN_DAYS_MS;
  }, [permissionStatus]);

  const subscribe = useCallback(async () => {
    if (!supported || !VAPID_PUBLIC_KEY) return;
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      await api.post('/notifications/subscribe', { subscription: sub.toJSON() });
      setSubscribed(true);
      setPermissionStatus(Notification.permission);
    } catch (err) {
      console.error('Push subscribe failed', err);
    } finally {
      setLoading(false);
    }
  }, [supported]);

  const unsubscribe = useCallback(async () => {
    if (!supported) return;
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      await api.delete('/notifications/subscribe');
      setSubscribed(false);
    } catch (err) {
      console.error('Push unsubscribe failed', err);
    } finally {
      setLoading(false);
    }
  }, [supported]);

  return { supported, subscribed, loading, subscribe, unsubscribe, permissionStatus, shouldShowPrompt };
}
