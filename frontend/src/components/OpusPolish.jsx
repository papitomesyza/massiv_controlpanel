import React, { useEffect, useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { api } from '../api';

// "Fix with Opus" for free-text fields, reusing the pitch builder's endpoint
// and its propose-then-Use-or-Discard flow: nothing is ever replaced without
// the writer choosing a version, and the field is locked while a request is in
// flight so an edit cannot be overwritten underneath it.

export function useAiPolishAvailable() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    api.get('/pitches/ai-status')
      .then(s => setEnabled(!!s.enabled))
      .catch(() => setEnabled(false));
  }, []);
  return enabled;
}

export default function OpusPolish({ enabled, value, onChange, loading, setLoading }) {
  const [variants, setVariants] = useState(null);
  const [error, setError] = useState('');

  if (!enabled) return null;
  const text = (value || '').trim();

  async function run() {
    if (loading || !text) return;
    setLoading(true);
    setVariants(null);
    setError('');
    try {
      const res = await api.post('/pitches/ai-polish', { text });
      const list = Array.isArray(res.variants) ? res.variants.filter(Boolean) : [];
      if (list.length === 0) setError('Opus returned nothing usable. Try again.');
      else setVariants(list);
    } catch (err) {
      const msg = err && err.message;
      if (msg === 'not_configured') setError('Add ANTHROPIC_API_KEY on the server to enable Opus polish.');
      else if (msg === 'polish_failed') setError('Could not reach Opus. Try again.');
      else setError(msg || 'Polish failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ marginTop: '5px' }}>
      <button
        type="button"
        className="btn-ghost"
        onClick={run}
        disabled={loading || !text}
        style={{ padding: '3px 8px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '5px', opacity: text ? 1 : 0.45 }}
        title="Fix grammar and clarity with Opus"
      >
        {loading ? <Loader2 size={11} className="pitch-spin" /> : <Sparkles size={11} />}
        {loading ? 'Writing options…' : 'Fix with Opus'}
      </button>
      {error && <div style={{ fontSize: '11px', color: 'var(--danger)', marginTop: '5px' }}>{error}</div>}
      {variants && (
        <div className="pitch-polish-card">
          <div className="pitch-polish-label">
            {variants.length === 1 ? 'Option' : `${variants.length} options`}
          </div>
          {variants.map((v, i) => (
            <div key={i} className="pitch-variant">
              <div className="pitch-variant-num">{i + 1}</div>
              <div className="pitch-polish-text pitch-variant-text">{v}</div>
              <button
                type="button"
                className="btn btn-primary btn-sm pitch-variant-use"
                onClick={() => { onChange(v); setVariants(null); }}
              >
                Use
              </button>
            </div>
          ))}
          <div style={{ marginTop: '10px' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVariants(null)}>
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
