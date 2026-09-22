import React, { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import Overlay from './Overlay';

// In-app confirmation, used in place of the native window.confirm so the prompt
// matches the rest of the designed app. Fully controlled: the parent renders it
// only when a decision is pending and supplies the copy plus the two handlers.
// It is a centred card on the shared overlay, so it stacks above whatever
// opened it and Escape or a scrim click cancels it alone. Pass cancelLabel null
// for a notice with a single acknowledge button.
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
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;
  const panelRef = useRef(null);

  // Enter confirms, but only while this dialog is the topmost overlay, which is
  // the case exactly when focus sits inside it.
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Enter' || busy) return;
      const host = panelRef.current && panelRef.current.closest('[data-overlay-root]');
      if (!host || !host.contains(document.activeElement)) return;
      if (document.activeElement && document.activeElement.tagName === 'BUTTON') return;
      e.preventDefault();
      onConfirmRef.current();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy]);

  return (
    <Overlay size="card" width={420} onClose={onCancel} guard={false} className="confirm-box" label={title}>
      <div ref={panelRef} className="confirm-body">
        <div className={`confirm-icon ${tone === 'danger' ? 'is-danger' : ''}`}>
          <AlertTriangle size={20} />
        </div>
        <div>
          <div className="confirm-title">{title}</div>
          {message && <div className="confirm-message">{message}</div>}
        </div>
      </div>
      <div className="modal-footer">
        {cancelLabel !== null && (
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
        )}
        <button
          className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
          onClick={onConfirm}
          disabled={busy}
          autoFocus
        >
          {busy ? 'Working...' : confirmLabel}
        </button>
      </div>
    </Overlay>
  );
}
