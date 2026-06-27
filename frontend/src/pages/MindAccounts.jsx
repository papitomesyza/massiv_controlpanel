import React, { useEffect, useState } from 'react';
import {
  Plus, Edit2, Trash2, Archive, ArchiveRestore, X,
  ExternalLink, CreditCard, FolderKanban, Clapperboard, User, KeyRound,
  Lock, Unlock, Eye, EyeOff, Copy, Check,
} from 'lucide-react';
import { api } from '../api';
import {
  generateSalt, DEFAULT_ITERATIONS, deriveKey,
  encryptSecret, decryptSecret, makeSentinel, verifyKey,
} from '../lib/vault';

const CATEGORY_META = {
  project:  { label: 'Project Accounts',  icon: FolderKanban, emptyMsg: 'No project accounts yet.' },
  studio:   { label: 'Studio Accounts',   icon: Clapperboard, emptyMsg: 'No studio accounts yet.' },
  personal: { label: 'Personal Accounts', icon: User,         emptyMsg: 'No personal accounts yet.' },
};

const BILLING_CYCLES = ['monthly', 'yearly', 'quarterly', 'weekly', 'one-time'];
const CURRENCIES = ['EUR', 'USD', 'GBP', 'ALL'];

const AUTH_METHODS = [
  { value: 'password',  label: 'Password' },
  { value: 'google',    label: 'Google' },
  { value: 'apple',     label: 'Apple' },
  { value: 'microsoft', label: 'Microsoft' },
  { value: 'facebook',  label: 'Facebook' },
  { value: 'github',    label: 'GitHub' },
  { value: 'other',     label: 'Other' },
];

function ssoLabel(method) {
  if (!method || method === 'password') return null;
  if (method === 'other') return 'External sign-in';
  const m = AUTH_METHODS.find(a => a.value === method);
  return m ? `Sign in with ${m.label}` : 'External sign-in';
}

const SECTION_LABEL = {
  fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em',
  textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '14px',
};

function billingCycleLabel(cycle) {
  switch (cycle) {
    case 'monthly':   return '/mo';
    case 'yearly':    return '/yr';
    case 'quarterly': return '/qtr';
    case 'weekly':    return '/wk';
    case 'one-time':  return ' one-time';
    default:          return '';
  }
}

function fmtRenewal(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function currencySymbol(currency) {
  switch (currency) {
    case 'EUR': return '€';
    case 'USD': return '$';
    case 'GBP': return '£';
    default:    return currency + ' ';
  }
}

// ── Vault Setup Modal ─────────────────────────────────────────────────────────

function VaultSetupModal({ onSetup, onClose }) {
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (pass.length < 8) { setError('Passphrase must be at least 8 characters'); return; }
    if (pass !== confirm) { setError('Passphrases do not match'); return; }
    setSaving(true);
    setError('');
    try {
      const salt = generateSalt();
      const key = await deriveKey(pass, salt, DEFAULT_ITERATIONS);
      const { cipher, iv } = await makeSentinel(key);
      await api.post('/vault/setup', { salt, sentinel_cipher: cipher, sentinel_iv: iv, iterations: DEFAULT_ITERATIONS });
      onSetup(key, { exists: true, salt, sentinel_cipher: cipher, sentinel_iv: iv, iterations: DEFAULT_ITERATIONS });
    } catch (err) {
      setError(err.message || 'Setup failed');
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <span className="modal-title">Set Up Vault</span>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div style={{ marginBottom: '16px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <p style={{ margin: '0 0 12px' }}>
            The vault encrypts passwords locally before storing them. Only the encrypted ciphertext reaches the
            server — your passphrase never leaves your device.
          </p>
          <div style={{
            background: 'rgba(255,80,80,0.08)', border: '1px solid rgba(255,80,80,0.25)',
            borderRadius: '8px', padding: '10px 14px', fontSize: '12px', color: '#ff8080',
          }}>
            <strong>Warning:</strong> If you forget your passphrase, stored passwords cannot be recovered.
            There is no reset option.
          </div>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <label className="form-label">Master Passphrase</label>
            <input
              className="input"
              type="password"
              value={pass}
              onChange={e => setPass(e.target.value)}
              placeholder="Minimum 8 characters"
              autoFocus
              autoComplete="new-password"
            />
          </div>
          <div className="form-row">
            <label className="form-label">Confirm Passphrase</label>
            <input
              className="input"
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Re-enter passphrase"
              autoComplete="new-password"
            />
          </div>
          {error && <p style={{ color: 'var(--danger)', fontSize: '13px', margin: '0 0 12px' }}>{error}</p>}
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Setting up…' : 'Create Vault'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Vault Unlock Modal ────────────────────────────────────────────────────────

function VaultUnlockModal({ vaultMeta, onUnlock, onClose }) {
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const [unlocking, setUnlocking] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setUnlocking(true);
    setError('');
    try {
      const key = await deriveKey(pass, vaultMeta.salt, vaultMeta.iterations);
      const ok = await verifyKey(key, vaultMeta.sentinel_cipher, vaultMeta.sentinel_iv);
      if (ok) {
        onUnlock(key);
      } else {
        setError('Incorrect passphrase');
        setUnlocking(false);
      }
    } catch (_) {
      setError('Failed to unlock vault');
      setUnlocking(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 400 }}>
        <div className="modal-header">
          <span className="modal-title">Unlock Vault</span>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <label className="form-label">Master Passphrase</label>
            <input
              className="input"
              type="password"
              value={pass}
              onChange={e => setPass(e.target.value)}
              placeholder="Enter your passphrase"
              autoFocus
              autoComplete="current-password"
            />
          </div>
          {error && <p style={{ color: 'var(--danger)', fontSize: '13px', margin: '0 0 12px' }}>{error}</p>}
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={unlocking}>
              {unlocking ? 'Unlocking…' : 'Unlock'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Account card ──────────────────────────────────────────────────────────────

function AccountCard({ account, onEdit, onDelete, onArchive, vaultKey, unlocked }) {
  const isSSO = account.auth_method && account.auth_method !== 'password';
  const hasPayment = !!account.has_payment && account.cost > 0;
  const hasPassword = !isSSO && !!account.password_cipher;
  const sym = currencySymbol(account.currency);
  const renewal = fmtRenewal(account.renewal_date);

  const [revealed, setRevealed] = useState(false);
  const [revealedText, setRevealedText] = useState('');
  const [revealError, setRevealError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!unlocked) {
      setRevealed(false);
      setRevealedText('');
      setRevealError('');
    }
  }, [unlocked]);

  async function handleReveal() {
    if (revealed) {
      setRevealed(false);
      setRevealedText('');
      return;
    }
    try {
      const text = await decryptSecret(vaultKey, account.password_cipher, account.password_iv);
      setRevealedText(text);
      setRevealError('');
      setRevealed(true);
    } catch (_) {
      setRevealError('Unable to decrypt');
    }
  }

  async function handleCopy() {
    try {
      const text = await decryptSecret(vaultKey, account.password_cipher, account.password_iv);
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {}
  }

  return (
    <div className="card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', opacity: account.archived ? 0.75 : 1 }}>
      {/* Header: platform + actions */}
      <div style={{ padding: '14px 14px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {account.platform}
          </div>
          {account.username && (
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {account.username}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
          <button className="btn-ghost" style={{ padding: '3px 5px' }} title="Edit" onClick={() => onEdit(account)}>
            <Edit2 size={12} />
          </button>
          <button className="btn-ghost" style={{ padding: '3px 5px' }} title={account.archived ? 'Unarchive' : 'Archive'} onClick={() => onArchive(account)}>
            {account.archived ? <ArchiveRestore size={12} /> : <Archive size={12} />}
          </button>
          <button className="btn-ghost" style={{ padding: '3px 5px', color: 'var(--danger)' }} title="Delete" onClick={() => onDelete(account)}>
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* URL */}
      {account.url && (
        <div style={{ padding: '8px 14px 0' }}>
          <a
            href={account.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--accent)', textDecoration: 'none' }}
            onClick={e => e.stopPropagation()}
          >
            <ExternalLink size={10} style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {account.url.replace(/^https?:\/\/(www\.)?/, '')}
            </span>
          </a>
        </div>
      )}

      {/* Notes */}
      {account.notes && (
        <div style={{ padding: '6px 14px 0' }}>
          <p style={{
            fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.4, margin: 0,
            overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          }}>
            {account.notes}
          </p>
        </div>
      )}

      {/* Password row */}
      {hasPassword && (
        <div style={{ padding: '8px 14px 0' }}>
          {unlocked ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <KeyRound size={11} color="var(--text-muted)" style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                {revealed ? (
                  <span style={{
                    fontSize: '12px', fontFamily: 'monospace', color: 'var(--text-primary)',
                    display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {revealedText}
                  </span>
                ) : (
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', letterSpacing: '0.12em' }}>
                    ••••••••
                  </span>
                )}
              </div>
              {revealError && (
                <span style={{ fontSize: '11px', color: 'var(--danger)', flexShrink: 0 }}>{revealError}</span>
              )}
              <button
                className="btn-ghost"
                style={{ padding: '2px 4px', flexShrink: 0 }}
                title={revealed ? 'Hide password' : 'Reveal password'}
                onClick={handleReveal}
              >
                {revealed ? <EyeOff size={11} /> : <Eye size={11} />}
              </button>
              <button
                className="btn-ghost"
                style={{ padding: '2px 4px', flexShrink: 0 }}
                title="Copy password"
                onClick={handleCopy}
              >
                {copied ? <Check size={11} color="var(--accent)" /> : <Copy size={11} />}
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Lock size={11} color="var(--text-muted)" />
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Password stored — unlock vault to view</span>
            </div>
          )}
        </div>
      )}

      {/* SSO badge */}
      {isSSO && (
        <div style={{ padding: '8px 14px 0' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center',
            background: 'rgba(114,60,235,0.1)', border: '1px solid rgba(114,60,235,0.25)',
            borderRadius: '6px', padding: '4px 8px',
            fontSize: '11px', color: '#9b7ef8', fontWeight: 600,
          }}>
            {ssoLabel(account.auth_method)}
          </span>
        </div>
      )}

      {/* Payment badge */}
      <div style={{ padding: '8px 14px 14px', marginTop: 'auto' }}>
        {hasPayment && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '5px',
            background: 'rgba(199,255,46,0.08)', border: '1px solid rgba(199,255,46,0.2)',
            borderRadius: '6px', padding: '4px 8px', flexWrap: 'wrap', rowGap: '2px',
          }}>
            <CreditCard size={10} color="var(--accent)" />
            <span style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: 600 }}>
              {sym}{Number(account.cost).toFixed(2)}{billingCycleLabel(account.billing_cycle)}
            </span>
            {renewal && (
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                · renews {renewal}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Category section ──────────────────────────────────────────────────────────

function AccountSection({ category, list, onEdit, onDelete, onArchive, vaultKey, unlocked }) {
  const meta = CATEGORY_META[category];
  return (
    <section style={{ marginBottom: '32px' }}>
      <h2 style={SECTION_LABEL}>{meta.label}</h2>
      {list.length === 0 ? (
        <div className="card" style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
          {meta.emptyMsg}
        </div>
      ) : (
        <div className="collections-tile-grid">
          {list.map(a => (
            <AccountCard
              key={a.id}
              account={a}
              onEdit={onEdit}
              onDelete={onDelete}
              onArchive={onArchive}
              vaultKey={vaultKey}
              unlocked={unlocked}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ── Add / Edit modal ──────────────────────────────────────────────────────────

function AccountModal({ account, vaultKey, unlocked, onSave, onClose }) {
  const isEdit = !!account;
  const hasExistingPassword = isEdit && !!account.password_cipher;

  const [form, setForm] = useState({
    category:      account?.category      || 'project',
    platform:      account?.platform      || '',
    username:      account?.username      || '',
    url:           account?.url           || '',
    notes:         account?.notes         || '',
    has_payment:   account ? !!account.has_payment : false,
    cost:          account?.cost != null  ? String(account.cost) : '0',
    billing_cycle: account?.billing_cycle || 'monthly',
    renewal_date:  account?.renewal_date  || '',
    currency:      account?.currency      || 'EUR',
    auth_method:   account?.auth_method   || 'password',
  });
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [clearPassword, setClearPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function set(key, val) {
    setForm(prev => ({ ...prev, [key]: val }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.platform.trim()) { setError('Platform is required'); return; }
    if (form.has_payment) {
      const n = parseFloat(form.cost);
      if (!isFinite(n) || n < 0 || n > 1000000) {
        setError('Cost must be a number between 0 and 1,000,000');
        return;
      }
    }
    setSaving(true);
    setError('');
    try {
      const data = {
        category:      form.category,
        platform:      form.platform,
        username:      form.username || null,
        url:           form.url || null,
        notes:         form.notes || null,
        has_payment:   form.has_payment ? 1 : 0,
        cost:          form.has_payment ? parseFloat(form.cost) : 0,
        billing_cycle: form.billing_cycle,
        renewal_date:  form.renewal_date || null,
        currency:      form.currency,
        auth_method:   form.auth_method,
      };

      if (form.auth_method === 'password') {
        if (clearPassword) {
          data.password_cipher = null;
          data.password_iv = null;
        } else if (unlocked && passwordInput.trim()) {
          const { cipher, iv } = await encryptSecret(vaultKey, passwordInput);
          data.password_cipher = cipher;
          data.password_iv = iv;
        }
        // if neither condition: password fields omitted → backend preserves existing value
      } else {
        // SSO account — clear any stored password
        data.password_cipher = null;
        data.password_iv = null;
      }

      await onSave(data);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to save');
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <span className="modal-title">{isEdit ? 'Edit Account' : 'New Account'}</span>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <label className="form-label">Category *</label>
            <select className="select" value={form.category} onChange={e => set('category', e.target.value)}>
              <option value="project">Project</option>
              <option value="studio">Studio</option>
              <option value="personal">Personal</option>
            </select>
          </div>
          <div className="form-row">
            <label className="form-label">Platform *</label>
            <input
              className="input"
              value={form.platform}
              onChange={e => set('platform', e.target.value)}
              placeholder="e.g. Instagram, Adobe, Netflix"
              autoFocus
            />
          </div>
          <div className="form-row">
            <label className="form-label">Username / Email</label>
            <input
              className="input"
              value={form.username}
              onChange={e => set('username', e.target.value)}
              placeholder="Login email or handle"
            />
          </div>
          <div className="form-row">
            <label className="form-label">Login URL</label>
            <input
              className="input"
              value={form.url}
              onChange={e => set('url', e.target.value)}
              placeholder="https://..."
            />
          </div>
          <div className="form-row">
            <label className="form-label">Notes</label>
            <textarea
              className="input"
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Optional notes"
              style={{ resize: 'vertical', minHeight: '60px' }}
            />
          </div>

          <div className="form-row">
            <label className="form-label">Sign-in method</label>
            <select
              className="select"
              value={form.auth_method}
              onChange={e => set('auth_method', e.target.value)}
            >
              {AUTH_METHODS.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          {/* Password field — only for password accounts */}
          {form.auth_method === 'password' && <div className="form-row">
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              Password
              {!unlocked && (
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 400 }}>
                  — unlock vault to save a password
                </span>
              )}
              {unlocked && hasExistingPassword && !clearPassword && (
                <span style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: 400 }}>
                  — stored
                </span>
              )}
            </label>
            <div style={{ position: 'relative' }}>
              <input
                className="input"
                type={showPassword ? 'text' : 'password'}
                value={clearPassword ? '' : passwordInput}
                onChange={e => setPasswordInput(e.target.value)}
                placeholder={
                  !unlocked
                    ? 'Unlock vault first'
                    : hasExistingPassword
                    ? 'Leave blank to keep existing password'
                    : 'Optional password'
                }
                disabled={!unlocked || clearPassword}
                autoComplete="new-password"
                style={{ paddingRight: unlocked && !clearPassword ? '36px' : undefined }}
              />
              {unlocked && !clearPassword && (
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  tabIndex={-1}
                  style={{
                    position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px',
                  }}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              )}
            </div>
            {unlocked && hasExistingPassword && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={clearPassword}
                  onChange={e => {
                    setClearPassword(e.target.checked);
                    if (e.target.checked) setPasswordInput('');
                  }}
                  style={{ accentColor: 'var(--danger)', width: 14, height: 14, flexShrink: 0 }}
                />
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Clear saved password</span>
              </label>
            )}
          </div>}

          {/* Payment toggle */}
          <div className="form-row">
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.has_payment}
                onChange={e => set('has_payment', e.target.checked)}
                style={{ accentColor: 'var(--accent)', width: 16, height: 16, flexShrink: 0 }}
              />
              <span className="form-label" style={{ margin: 0 }}>Active paid subscription</span>
            </label>
          </div>

          {form.has_payment && (
            <>
              <div style={{ display: 'flex', gap: '10px' }}>
                <div className="form-row" style={{ flex: 1, margin: 0 }}>
                  <label className="form-label">Cost</label>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    max="1000000"
                    step="0.01"
                    value={form.cost}
                    onChange={e => set('cost', e.target.value)}
                  />
                </div>
                <div className="form-row" style={{ flex: 1, margin: 0 }}>
                  <label className="form-label">Currency</label>
                  <select className="select" value={form.currency} onChange={e => set('currency', e.target.value)}>
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row" style={{ marginTop: '10px' }}>
                <label className="form-label">Billing Cycle</label>
                <select className="select" value={form.billing_cycle} onChange={e => set('billing_cycle', e.target.value)}>
                  {BILLING_CYCLES.map(c => (
                    <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <label className="form-label">Renewal Date</label>
                <input
                  className="input"
                  type="date"
                  value={form.renewal_date}
                  onChange={e => set('renewal_date', e.target.value)}
                />
              </div>
            </>
          )}

          {error && <p style={{ color: 'var(--danger)', fontSize: '13px', margin: '0 0 12px' }}>{error}</p>}
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MindAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [archivedAccounts, setArchivedAccounts] = useState([]);
  const [monthlySpend, setMonthlySpend] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('active');
  const [showModal, setShowModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);

  // Vault — in memory only, never written to storage
  const [vaultKey, setVaultKey] = useState(null);
  const [vaultMeta, setVaultMeta] = useState(null);
  const [showVaultSetup, setShowVaultSetup] = useState(false);
  const [showVaultUnlock, setShowVaultUnlock] = useState(false);

  const unlocked = vaultKey !== null;

  async function loadData() {
    try {
      const [active, archived, spend] = await Promise.all([
        api.get('/mind-accounts'),
        api.get('/mind-accounts/archived'),
        api.get('/mind-accounts/monthly-spend'),
      ]);
      setAccounts(active);
      setArchivedAccounts(archived);
      setMonthlySpend(spend);
    } catch (_) {}
  }

  useEffect(() => {
    async function init() {
      await loadData();
      try {
        const meta = await api.get('/vault/meta');
        setVaultMeta(meta);
      } catch (_) {}
    }
    init().finally(() => setLoading(false));
  }, []);

  function openAdd() {
    setEditingAccount(null);
    setShowModal(true);
  }

  function openEdit(acc) {
    setEditingAccount(acc);
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingAccount(null);
  }

  async function handleSave(data) {
    if (editingAccount) {
      await api.put(`/mind-accounts/${editingAccount.id}`, data);
    } else {
      await api.post('/mind-accounts', data);
    }
    await loadData();
  }

  async function handleDelete(account) {
    if (!confirm(`Delete account "${account.platform}"? This cannot be undone.`)) return;
    try {
      await api.del(`/mind-accounts/${account.id}`);
      await loadData();
    } catch (err) { alert(err.message || 'Failed to delete'); }
  }

  async function handleArchive(account) {
    try {
      const action = account.archived ? 'unarchive' : 'archive';
      await api.post(`/mind-accounts/${account.id}/${action}`, {});
      await loadData();
    } catch (err) { alert(err.message || 'Failed to update'); }
  }

  function handleVaultSetup(key, meta) {
    setVaultKey(key);
    setVaultMeta(meta);
    setShowVaultSetup(false);
  }

  function handleVaultUnlock(key) {
    setVaultKey(key);
    setShowVaultUnlock(false);
  }

  const byCategory = (cat, list) => list.filter(a => a.category === cat);

  if (loading) return (
    <div className="page-header">
      <h1 className="page-title">Accounts</h1>
    </div>
  );

  const totalActive = accounts.length;
  const totalArchived = archivedAccounts.length;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Accounts</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {vaultMeta !== null && (
            !vaultMeta.exists ? (
              <button
                className="btn btn-ghost"
                style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}
                onClick={() => setShowVaultSetup(true)}
              >
                <Lock size={13} />
                Set up Vault
              </button>
            ) : unlocked ? (
              <>
                <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--accent)' }}>
                  <Unlock size={13} />
                  Vault unlocked
                </span>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}
                  onClick={() => setVaultKey(null)}
                >
                  <Lock size={13} />
                  Lock
                </button>
              </>
            ) : (
              <>
                <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--text-muted)' }}>
                  <Lock size={13} />
                  Vault locked
                </span>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}
                  onClick={() => setShowVaultUnlock(true)}
                >
                  <Unlock size={13} />
                  Unlock
                </button>
              </>
            )
          )}
          <button className="btn btn-primary" onClick={openAdd}>
            <Plus size={16} /> New Account
          </button>
        </div>
      </div>

      {/* Monthly spend summary */}
      {monthlySpend !== null && (
        <div className="card" style={{ padding: '16px 20px', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <CreditCard size={20} color="var(--accent)" style={{ flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '3px' }}>
              Monthly Spend
            </div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
              €{monthlySpend.total.toFixed(2)}
              <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 400, marginLeft: '6px' }}>/ month</span>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '28px', borderBottom: '1px solid var(--border)', paddingBottom: '0' }}>
        {['active', 'archived'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '8px 16px', fontSize: '13px', fontWeight: 600,
              color: activeTab === tab ? 'var(--accent)' : 'var(--text-muted)',
              borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: '-1px', textTransform: 'capitalize', transition: 'color 0.15s',
            }}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            {tab === 'active' && totalActive > 0 && (
              <span style={{ marginLeft: '6px', fontSize: '11px', background: 'var(--accent)', color: '#000', borderRadius: '10px', padding: '1px 6px', fontWeight: 700 }}>
                {totalActive}
              </span>
            )}
            {tab === 'archived' && totalArchived > 0 && (
              <span style={{ marginLeft: '6px', fontSize: '11px', background: '#333', color: '#888', borderRadius: '10px', padding: '1px 6px', fontWeight: 700 }}>
                {totalArchived}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Active tab */}
      {activeTab === 'active' && (
        totalActive === 0 ? (
          <div className="card" style={{ padding: '48px 20px', textAlign: 'center' }}>
            <KeyRound size={32} color="var(--text-muted)" style={{ margin: '0 auto 12px', display: 'block' }} />
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '16px' }}>
              No accounts yet. Add logins and subscriptions to keep track.
            </p>
            <button className="btn btn-primary" onClick={openAdd}>
              <Plus size={15} /> Add your first account
            </button>
          </div>
        ) : (
          <>
            <AccountSection category="project"  list={byCategory('project', accounts)}  onEdit={openEdit} onDelete={handleDelete} onArchive={handleArchive} vaultKey={vaultKey} unlocked={unlocked} />
            <AccountSection category="studio"   list={byCategory('studio', accounts)}   onEdit={openEdit} onDelete={handleDelete} onArchive={handleArchive} vaultKey={vaultKey} unlocked={unlocked} />
            <AccountSection category="personal" list={byCategory('personal', accounts)} onEdit={openEdit} onDelete={handleDelete} onArchive={handleArchive} vaultKey={vaultKey} unlocked={unlocked} />
          </>
        )
      )}

      {/* Archived tab */}
      {activeTab === 'archived' && (
        totalArchived === 0 ? (
          <div className="card" style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
            No archived accounts.
          </div>
        ) : (
          <>
            {byCategory('project', archivedAccounts).length > 0 && (
              <section style={{ marginBottom: '32px' }}>
                <h2 style={SECTION_LABEL}>Project Accounts — Archived</h2>
                <div className="collections-tile-grid">
                  {byCategory('project', archivedAccounts).map(a => (
                    <AccountCard key={a.id} account={a} onEdit={openEdit} onDelete={handleDelete} onArchive={handleArchive} vaultKey={vaultKey} unlocked={unlocked} />
                  ))}
                </div>
              </section>
            )}
            {byCategory('studio', archivedAccounts).length > 0 && (
              <section style={{ marginBottom: '32px' }}>
                <h2 style={SECTION_LABEL}>Studio Accounts — Archived</h2>
                <div className="collections-tile-grid">
                  {byCategory('studio', archivedAccounts).map(a => (
                    <AccountCard key={a.id} account={a} onEdit={openEdit} onDelete={handleDelete} onArchive={handleArchive} vaultKey={vaultKey} unlocked={unlocked} />
                  ))}
                </div>
              </section>
            )}
            {byCategory('personal', archivedAccounts).length > 0 && (
              <section style={{ marginBottom: '32px' }}>
                <h2 style={SECTION_LABEL}>Personal Accounts — Archived</h2>
                <div className="collections-tile-grid">
                  {byCategory('personal', archivedAccounts).map(a => (
                    <AccountCard key={a.id} account={a} onEdit={openEdit} onDelete={handleDelete} onArchive={handleArchive} vaultKey={vaultKey} unlocked={unlocked} />
                  ))}
                </div>
              </section>
            )}
          </>
        )
      )}

      {showModal && (
        <AccountModal
          account={editingAccount}
          vaultKey={vaultKey}
          unlocked={unlocked}
          onSave={handleSave}
          onClose={closeModal}
        />
      )}
      {showVaultSetup && (
        <VaultSetupModal onSetup={handleVaultSetup} onClose={() => setShowVaultSetup(false)} />
      )}
      {showVaultUnlock && vaultMeta?.exists && (
        <VaultUnlockModal vaultMeta={vaultMeta} onUnlock={handleVaultUnlock} onClose={() => setShowVaultUnlock(false)} />
      )}
    </div>
  );
}
