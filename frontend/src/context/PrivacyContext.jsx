import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../api';

// App wide privacy mode. When hidden is true every money figure and count is
// blurred behind a CSS filter, so a bystander glancing at the screen sees no
// numbers. The real strings stay in the DOM underneath the blur, so nothing
// shifts on toggle. Default is hidden, and it stays hidden while the persisted
// setting is still loading.
const PrivacyContext = createContext({ hidden: true, loading: true, toggle: () => {} });

const KEY = 'privacy_mode';

export function PrivacyProvider({ children }) {
  const [hidden, setHidden] = useState(true);   // concealed on first load
  const [loading, setLoading] = useState(true); // and while the setting loads

  // Read the persisted choice on boot, same settings API used for the
  // dashboard layout. Stored '0' means the user chose to reveal; anything else
  // (including a missing key) stays hidden.
  useEffect(() => {
    const auth = localStorage.getItem('massiv_auth');
    if (!auth) { setLoading(false); return; }
    api.get(`/settings/${KEY}`)
      .then(res => { setHidden(!(res && res.value === '0')); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const persist = useCallback(next => {
    api.post('/settings', { key: KEY, value: next ? '1' : '0' }).catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    setHidden(prev => { const next = !prev; persist(next); return next; });
  }, [persist]);

  // Force back to hidden, persisting only on an actual reveal to hidden change.
  const conceal = useCallback(() => {
    setHidden(prev => { if (!prev) persist(true); return true; });
  }, [persist]);

  // Shift+H toggles globally, unless focus is in a field.
  useEffect(() => {
    function onKey(e) {
      if (!e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      if (String(e.key).toLowerCase() !== 'h') return;
      const el = e.target;
      const tag = el && el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (el && el.isContentEditable)) return;
      e.preventDefault();
      toggle();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  // Losing the tab is the real threat: re-conceal the moment focus leaves.
  useEffect(() => {
    window.addEventListener('blur', conceal);
    return () => window.removeEventListener('blur', conceal);
  }, [conceal]);

  const value = { hidden: hidden || loading, loading, toggle };
  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

export function usePrivacy() {
  return useContext(PrivacyContext);
}

// Wrap any sensitive value. Keeps the real children in the DOM and only blurs
// them, so the layout never shifts. Defaults to an inline span; pass `as` for a
// different element.
export function Private({ children, as: Tag = 'span', className = '', style, ...rest }) {
  const { hidden } = usePrivacy();
  const cls = ['private-value', hidden ? 'is-hidden' : '', className].filter(Boolean).join(' ');
  return (
    <Tag className={cls} style={style} {...rest}>
      {children}
    </Tag>
  );
}
