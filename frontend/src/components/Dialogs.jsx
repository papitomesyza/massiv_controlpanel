import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';

// One ConfirmDialog host for a page whose actions live in many small
// components. notify(title, message) shows a notice with a single OK; ask({...})
// shows a question and resolves true on confirm, false on cancel. Both render
// the shared ConfirmDialog, so no page needs the native alert or confirm.
//
// Wrap the page in <DialogProvider> and call useDialogs() anywhere under it.
// Outside a provider the hook falls back to doing nothing, never to the
// browser's own prompts.

const DialogContext = createContext({
  notify: () => {},
  ask: () => Promise.resolve(false),
});

export function useDialogs() {
  return useContext(DialogContext);
}

export function DialogProvider({ children }) {
  const [current, setCurrent] = useState(null);
  const resolver = useRef(null);

  const close = useCallback(result => {
    const done = resolver.current;
    resolver.current = null;
    setCurrent(null);
    if (done) done(result);
  }, []);

  const notify = useCallback((title, message) => {
    if (resolver.current) resolver.current(false);
    resolver.current = null;
    setCurrent({ title, message, confirmLabel: 'OK', cancelLabel: null });
  }, []);

  const ask = useCallback(({ title, message, confirmLabel = 'Confirm', tone = 'default' }) => (
    new Promise(resolve => {
      if (resolver.current) resolver.current(false);
      resolver.current = resolve;
      setCurrent({ title, message, confirmLabel, cancelLabel: 'Cancel', tone });
    })
  ), []);

  const value = useRef({ notify, ask }).current;

  return (
    <DialogContext.Provider value={value}>
      {children}
      {current && (
        <ConfirmDialog
          title={current.title}
          message={current.message}
          confirmLabel={current.confirmLabel}
          cancelLabel={current.cancelLabel}
          tone={current.tone}
          onConfirm={() => close(true)}
          onCancel={() => close(false)}
        />
      )}
    </DialogContext.Provider>
  );
}
