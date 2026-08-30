import React, { useEffect, useState, useCallback } from 'react';
import api from '../utils/api';
import ConfirmModal from './ConfirmModal';

function formatRelativeTime(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function ActiveSessions({ currentSessionId }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [revoking, setRevoking] = useState(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmSingle, setConfirmSingle] = useState(null);

  const loadSessions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get('/auth/sessions');
      setSessions(res.data.sessions ?? res.data);
    } catch {
      setError('Failed to load sessions. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleRevoke = async (sessionId) => {
    setRevoking(sessionId);
    try {
      await api.delete(`/auth/sessions/${sessionId}`);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch {
      setError('Failed to revoke session.');
    } finally {
      setRevoking(null);
      setConfirmSingle(null);
    }
  };

  const handleRevokeAll = async () => {
    setRevoking('all');
    try {
      await api.delete('/auth/sessions?except=current');
      setSessions((prev) => prev.filter((s) => s.id === currentSessionId));
    } catch {
      setError('Failed to revoke sessions.');
    } finally {
      setRevoking(null);
      setConfirmAll(false);
    }
  };

  if (loading)
    return (
      <div className="text-sm text-gray-400 py-4" aria-busy="true">
        Loading sessions…
      </div>
    );

  return (
    <section aria-label="Active Sessions" className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-300">Active Sessions</h3>
        {sessions.length > 1 && (
          <button
            onClick={() => setConfirmAll(true)}
            disabled={revoking === 'all'}
            className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors"
            aria-label="Revoke all other sessions"
          >
            {revoking === 'all' ? 'Revoking…' : 'Revoke all other sessions'}
          </button>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-400 mb-2" role="alert">
          {error}
        </p>
      )}

      {sessions.length === 0 ? (
        <p className="text-sm text-gray-500">No active sessions found.</p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((session) => (
            <li
              key={session.id}
              className={`flex items-center justify-between bg-gray-800 rounded-xl px-4 py-3 border ${
                session.id === currentSessionId ? 'border-primary-500/40' : 'border-gray-700'
              }`}
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-sm text-white flex items-center gap-2">
                  {session.device || 'Unknown device'}
                  {session.id === currentSessionId && (
                    <span className="text-xs bg-primary-500/20 text-primary-400 px-1.5 py-0.5 rounded">
                      Current
                    </span>
                  )}
                </span>
                <span className="text-xs text-gray-500 truncate">
                  {session.ipAddress || 'IP unavailable'} ·{' '}
                  {formatRelativeTime(session.lastActiveAt)}
                </span>
              </div>
              {session.id !== currentSessionId && (
                <button
                  onClick={() => setConfirmSingle(session)}
                  disabled={revoking === session.id}
                  className="ml-4 text-xs text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors shrink-0"
                  aria-label={`Revoke session on ${session.device}`}
                >
                  {revoking === session.id ? 'Revoking…' : 'Revoke'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>

      <ConfirmModal
        isOpen={confirmAll}
        onClose={() => setConfirmAll(false)}
        onConfirm={handleRevokeAll}
        title="Revoke all other sessions?"
        message="This will immediately invalidate all other active sessions. You will remain logged in on this device. Any ongoing operations on those sessions will be interrupted."
        confirmLabel="Revoke All"
        confirmVariant="danger"
        loading={revoking === 'all'}
      />

      <ConfirmModal
        isOpen={!!confirmSingle}
        onClose={() => setConfirmSingle(null)}
        onConfirm={() => handleRevoke(confirmSingle.id)}
        title="Revoke session?"
        message={`This will immediately invalidate the session on "${confirmSingle?.device || 'Unknown device'}". The user will be signed out and any ongoing operations on that session will be interrupted.`}
        confirmLabel="Revoke Session"
        confirmVariant="danger"
        loading={revoking === confirmSingle?.id}
      />
    </section>
  );
}

export default ActiveSessions;
