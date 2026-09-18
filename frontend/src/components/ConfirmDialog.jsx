import React, { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

// In-app confirmation, used in place of the native window.confirm so the prompt
// matches the rest of the designed app. Fully controlled: the parent renders it
// only when a decision is pending and supplies the copy plus the two handlers.
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',           // 'default' or 'danger'
  onConfirm,
  onCancel,
  busy = false,
}) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel, onConfirm]);

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal-box confirm-box">
        <div className="confirm-body">
          <div className={`confirm-icon ${tone === 'danger' ? 'is-danger' : ''}`}>
            <AlertTriangle size={20} />
          </div>
          <div>
            <div className="confirm-title">{title}</div>
            {message && <div className="confirm-message">{message}</div>}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
          <button
            className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy}
            autoFocus
          >
            {busy ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
