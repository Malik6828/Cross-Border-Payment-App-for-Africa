import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

export default function ConfirmModal({ isOpen, onClose, onConfirm, title, message, confirmLabel, confirmVariant, loading }) {
  if (!isOpen) return null;

  const confirmButtonClass =
    confirmVariant === 'danger'
      ? 'bg-red-600 hover:bg-red-700'
      : 'bg-primary-500 hover:bg-primary-600';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between bg-gray-800 px-6 py-4">
          <div className="flex items-center gap-2">
            <AlertTriangle size={20} className="text-red-400" />
            <h3 className="text-lg font-semibold text-white">{title}</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="px-6 py-6">
          <p className="text-sm text-gray-300 leading-relaxed">{message}</p>

          <div className="flex gap-3 pt-6">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 bg-gray-800 hover:bg-gray-700 rounded-xl py-3 text-white font-medium transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={loading}
              className={`flex-1 ${confirmButtonClass} rounded-xl py-3 text-white font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-50`}
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" role="status" aria-label="Loading" />
              ) : (
                confirmLabel || 'Confirm'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
