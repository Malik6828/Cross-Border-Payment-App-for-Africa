import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Monitor, Trash2, LogOut, ShieldCheck } from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import ConfirmModal from '../components/ConfirmModal';

export default function Sessions() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmSingle, setConfirmSingle] = useState(null);
  const [trustedDevice, setTrustedDevice] = useState(null); // { expiry: Date } | null

  const load = async () => {
    try {
      const res = await api.get('/auth/sessions');
      setSessions(res.data.sessions);
    } catch {
      toast.error('Failed to load sessions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const raw = localStorage.getItem('afripay_device_token');
    if (raw) {
      try {
        const payload = JSON.parse(atob(raw.split('.')[1]));
        if (payload.exp * 1000 > Date.now()) {
          setTrustedDevice({ expiry: new Date(payload.exp * 1000) });
        } else {
          localStorage.removeItem('afripay_device_token');
        }
      } catch {
        localStorage.removeItem('afripay_device_token');
      }
    }
  }, []);

  const revoke = async (id) => {
    setRevoking(id);
    try {
      await api.delete(`/auth/sessions/${id}`);
      setSessions((s) => s.filter((x) => x.id !== id));
      toast.success('Session revoked');
    } catch {
      toast.error('Failed to revoke session');
    } finally {
      setRevoking(null);
      setConfirmSingle(null);
    }
  };

  const revokeTrustedDevice = () => {
    localStorage.removeItem('afripay_device_token');
    setTrustedDevice(null);
    toast.success('Device trust removed');
  };

  const revokeAll = async () => {
    setRevoking('all');
    try {
      await api.delete('/auth/sessions?keep_current=true');
      await load();
      toast.success('All other sessions revoked');
    } catch {
      toast.error('Failed to revoke sessions');
    } finally {
      setRevoking(null);
      setConfirmAll(false);
    }
  };

  return (
    <div className="px-4 py-6 max-w-lg mx-auto">
      <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white mb-6 flex items-center gap-1">
        <ArrowLeft size={18} /> Back
      </button>

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Active Sessions</h2>
        {sessions.length > 1 && (
          <button
            onClick={() => setConfirmAll(true)}
            disabled={revoking === 'all'}
            className="text-sm text-red-400 hover:text-red-300 flex items-center gap-1 disabled:opacity-50"
          >
            <LogOut size={14} /> Logout everywhere
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="skeleton h-20 rounded-xl" />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No active sessions</p>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
            <div
              key={s.id}
              className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-start justify-between gap-3"
            >
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 bg-gray-800 rounded-lg flex items-center justify-center shrink-0">
                  <Monitor size={16} className={s.is_current ? 'text-primary-400' : 'text-gray-400'} />
                </div>
                <div>
                  <p className="text-sm text-white font-medium truncate max-w-[200px]">
                    {s.device_info ? s.device_info.slice(0, 60) : 'Unknown device'}
                    {s.is_current && (
                      <span className="ml-2 text-xs bg-primary-500/20 text-primary-400 px-1.5 py-0.5 rounded-full">
                        Current
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {s.ip_address || 'Unknown IP'} · Last active{' '}
                    {new Date(s.last_active).toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-600">
                    Created {new Date(s.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>

              {!s.is_current && (
                <button
                  onClick={() => setConfirmSingle(s)}
                  disabled={revoking === s.id}
                  className="text-red-400 hover:text-red-300 shrink-0 disabled:opacity-50"
                  aria-label="Revoke session"
                >
                  {revoking === s.id ? (
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Trash2 size={16} />
                  )}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {trustedDevice && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Trusted Device</h3>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-primary-500/20 rounded-lg flex items-center justify-center shrink-0">
                <ShieldCheck size={16} className="text-primary-400" />
              </div>
              <div>
                <p className="text-sm text-white font-medium">This device</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Trusted until {trustedDevice.expiry.toLocaleDateString()}
                </p>
              </div>
            </div>
            <button
              onClick={revokeTrustedDevice}
              className="text-red-400 hover:text-red-300 shrink-0"
              aria-label="Remove device trust"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={confirmAll}
        onClose={() => setConfirmAll(false)}
        onConfirm={revokeAll}
        title="Logout from all other sessions?"
        message="This will immediately invalidate all other active sessions. You will remain logged in on this device. Any ongoing operations on those sessions will be interrupted."
        confirmLabel="Logout Everywhere"
        confirmVariant="danger"
        loading={revoking === 'all'}
      />

      <ConfirmModal
        isOpen={!!confirmSingle}
        onClose={() => setConfirmSingle(null)}
        onConfirm={() => revoke(confirmSingle.id)}
        title="Revoke session?"
        message={`This will immediately invalidate the session${confirmSingle ? ` on "${confirmSingle.device_info || 'Unknown device'}"` : ''}. The user will be signed out and any ongoing operations on that session will be interrupted.`}
        confirmLabel="Revoke Session"
        confirmVariant="danger"
        loading={revoking === confirmSingle?.id}
      />
    </div>
  );
}
