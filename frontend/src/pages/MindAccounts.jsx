import React, { useCallback, useEffect, useState } from 'react';
import {
  Plus, Edit2, Trash2, Archive, ArchiveRestore, ExternalLink, FolderKanban, Clapperboard, User,
  KeyRound, Lock, Unlock, LockKeyhole, ShieldPlus, Eye, EyeOff, Copy, Check, CreditCard, StickyNote,
  Apple, Chrome, Github, Facebook, LayoutGrid, LogIn,
} from 'lucide-react';
import { api } from '../api';
import {
  generateSalt, DEFAULT_ITERATIONS, deriveKey,
  encryptSecret, decryptSecret, makeSentinel, verifyKey,
} from '../lib/vault';
import { pristinaToday, addDays } from '../lib/pristinaDate';
import { Private } from '../context/PrivacyContext';
import Overlay from '../components/Overlay';
import ConfirmDialog from '../components/ConfirmDialog';
import DateField from '../components/DateField';
import Ring from '../components/Ring';
import IconMenu from '../components/IconMenu';
import { IconToggles, IconLink } from '../components/DbBits';
import '../styles/mind.css';

// ── Vault timing ──────────────────────────────────────────────────────────────
// The key lives in memory only. It is dropped after five minutes with no
// pointer or key activity on the page, or once the tab has been hidden for a
// minute; a revealed password hides itself after 20 seconds, and a copied one
// is cleared from the clipboard after 30 seconds if it is still there.
const IDLE_LOCK_MS = 5 * 60 * 1000;
const HIDDEN_LOCK_MS = 60 * 1000;
const REVEAL_MS = 20 * 1000;
const CLIPBOARD_CLEAR_MS = 30 * 1000;
const MIN_PASSPHRASE = 10;

const CATEGORIES = ['project', 'studio', 'personal'];
const CATEGORY_META = {
  project:  { title: 'Project', Icon: FolderKanban },
  studio:   { title: 'Studio', Icon: Clapperboard },
  personal: { title: 'Personal', Icon: User },
};
const CATEGORY_TOGGLES = CATEGORIES.map(key => ({ key, Icon: CATEGORY_META[key].Icon, title: CATEGORY_META[key].title }));

const TABS = [
  { key: 'active', Icon: KeyRound, title: 'Active' },
  { key: 'archived', Icon: Archive, title: 'Archived' },
];

const BILLING_CYCLES = ['monthly', 'yearly', 'quarterly', 'weekly', 'one-time'];
const CYCLE_LABEL = { monthly: 'Monthly', yearly: 'Yearly', quarterly: 'Quarterly', weekly: 'Weekly', 'one-time': 'One time' };
const CYCLE_SUFFIX = { monthly: '/mo', yearly: '/yr', quarterly: '/qtr', weekly: '/wk', 'one-time': '' };
const CURRENCIES = ['EUR', 'USD', 'GBP', 'ALL'];

const AUTH_METHODS = [
  { value: 'password',  label: 'Password',  Icon: KeyRound },
  { value: 'google',    label: 'Google',    Icon: Chrome },
  { value: 'apple',     label: 'Apple',     Icon: Apple },
  { value: 'microsoft', label: 'Microsoft', Icon: LayoutGrid },
  { value: 'facebook',  label: 'Facebook',  Icon: Facebook },
  { value: 'github',    label: 'GitHub',    Icon: Github },
  { value: 'other',     label: 'Other',     Icon: LogIn },
];

function authMeta(method) {
  return AUTH_METHODS.find(a => a.value === (method || 'password')) || AUTH_METHODS[AUTH_METHODS.length - 1];
}

function currencySymbol(currency) {
  switch (currency) {
    case 'EUR': return '€';
    case 'USD': return '$';
    case 'GBP': return '£';
    default:    return `${currency} `;
  }
}

function money(currency, n) {
  return `${currencySymbol(currency)}${Number(n || 0).toFixed(2)}`;
}

// EUR first, then the rest in a stable order.
function currencyOrder(a, b) {
  if (a === 'EUR') return -1;
  if (b === 'EUR') return 1;
  return a.localeCompare(b);
}

// ── Renewal dates ─────────────────────────────────────────────────────────────
// Pure calendar arithmetic on YYYY-MM-DD, measured against today in Pristina.

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function ymdUTC(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function daysBetween(from, to) {
  return Math.round((ymdUTC(to) - ymdUTC(from)) / 86400000);
}

// Shift by whole months, holding the day of month and clamping it to the
// month's length, so the 31st renews on the 28th or 30th and not a day later.
function addMonthsClamped(ymd, months) {
  const [y, m, d] = ymd.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const yy = first.getUTCFullYear();
  const mm = first.getUTCMonth();
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

const CYCLE_MONTHS = { monthly: 1, quarterly: 3, yearly: 12 };

// The next renewal on or after today, for display only; the stored date is
// never changed. A one time payment keeps its stored date.
function nextRenewal(stored, cycle, today) {
  if (!stored || !YMD.test(stored)) return null;
  if (cycle === 'one-time' || stored >= today) return stored;
  if (cycle === 'weekly') {
    const k = Math.ceil(daysBetween(stored, today) / 7);
    return addDays(stored, 7 * k);
  }
  const step = CYCLE_MONTHS[cycle] || 1;
  const [sy, sm] = stored.split('-').map(Number);
  const [ty, tm] = today.split('-').map(Number);
  let k = Math.max(1, Math.floor(((ty - sy) * 12 + (tm - sm)) / step) - 1);
  let next = addMonthsClamped(stored, k * step);
  while (next < today) { k += 1; next = addMonthsClamped(stored, k * step); }
  return next;
}

function fmtDate(ymd) {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(ymdUTC(ymd)));
}

function renewalInfo(account, today) {
  const paid = !!account.has_payment && Number(account.cost) > 0;
  if (!paid) return null;
  const next = nextRenewal(account.renewal_date, account.billing_cycle, today);
  if (!next) return null;
  return { next, days: daysBetween(today, next) };
}

// ── Clipboard ─────────────────────────────────────────────────────────────────

let clipboardTimer = null;

// Clear the clipboard later, but only when it still holds what was copied, so
// anything the user copied since is left alone. Where the browser does not
// allow reading the clipboard, it is left as it is.
function scheduleClipboardClear(text) {
  clearTimeout(clipboardTimer);
  clipboardTimer = setTimeout(async () => {
    clipboardTimer = null;
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) return;
      const current = await navigator.clipboard.readText();
      if (current === text) await navigator.clipboard.writeText('');
    } catch (_) { /* reading the clipboard is not allowed here */ }
  }, CLIPBOARD_CLEAR_MS);
}

// ── Vault overlays ────────────────────────────────────────────────────────────

function FormFooter({ formId, onClose, busy, label }) {
  return (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>
        {busy ? 'Working...' : label}
      </button>
    </>
  );
}

function VaultSetupModal({ onSetup, onClose }) {
  const [pass, setPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (pass.length < MIN_PASSPHRASE) { setError(`At least ${MIN_PASSPHRASE} characters`); return; }
    if (pass !== confirmPass) { setError('Passphrases do not match'); return; }
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
    <Overlay
      title="Set Up Vault"
      onClose={onClose}
      width={440}
      footer={<FormFooter formId="vault-setup" onClose={onClose} busy={saving} label="Create" />}
    >
      <form id="vault-setup" onSubmit={handleSubmit}>
        <p className="db-sub" style={{ whiteSpace: 'normal', margin: '0 0 16px' }}>
          Passwords are encrypted on this device. A forgotten passphrase cannot be recovered.
        </p>
        <div className="form-row">
          <label className="form-label">Passphrase</label>
          <input className="input" type="password" value={pass} onChange={e => setPass(e.target.value)} autoFocus autoComplete="new-password" />
        </div>
        <div className="form-row">
          <label className="form-label">Confirm</label>
          <input className="input" type="password" value={confirmPass} onChange={e => setConfirmPass(e.target.value)} autoComplete="new-password" />
        </div>
        {error && <div className="error-msg">{error}</div>}
      </form>
    </Overlay>
  );
}

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
      if (await verifyKey(key, vaultMeta.sentinel_cipher, vaultMeta.sentinel_iv)) {
        onUnlock(key);
        return;
      }
      setError('Incorrect passphrase');
    } catch (_) {
      setError('Failed to unlock');
    }
    setUnlocking(false);
  }

  return (
    <Overlay
      title="Unlock Vault"
      onClose={onClose}
      width={400}
      guard={false}
      footer={<FormFooter formId="vault-unlock" onClose={onClose} busy={unlocking} label="Unlock" />}
    >
      <form id="vault-unlock" onSubmit={handleSubmit}>
        <div className="form-row">
          <label className="form-label">Passphrase</label>
          <input className="input" type="password" value={pass} onChange={e => setPass(e.target.value)} autoFocus autoComplete="current-password" />
        </div>
        {error && <div className="error-msg">{error}</div>}
      </form>
    </Overlay>
  );
}

// Change passphrase. Everything happens here in the browser: the current
// passphrase is checked against the sentinel, every stored password (active
// and archived) is decrypted with the old key and encrypted again under a key
// derived from the new passphrase with a new salt. Nothing is sent unless every
// password decrypted, and the server applies it all in one transaction.
function ChangePassphraseModal({ vaultMeta, onDone, onClose }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmNext, setConfirmNext] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (next.length < MIN_PASSPHRASE) { setError(`At least ${MIN_PASSPHRASE} characters`); return; }
    if (next !== confirmNext) { setError('Passphrases do not match'); return; }
    setBusy(true);
    setError('');
    try {
      const oldKey = await deriveKey(current, vaultMeta.salt, vaultMeta.iterations);
      if (!(await verifyKey(oldKey, vaultMeta.sentinel_cipher, vaultMeta.sentinel_iv))) {
        setError('Incorrect passphrase');
        setBusy(false);
        return;
      }

      const [active, archived] = await Promise.all([
        api.get('/mind-accounts'),
        api.get('/mind-accounts/archived'),
      ]);
      const stored = [...active, ...archived].filter(a => a.password_cipher);

      const plain = [];
      for (const a of stored) {
        try {
          plain.push({ id: a.id, text: await decryptSecret(oldKey, a.password_cipher, a.password_iv) });
        } catch (_) {
          setNotice({ title: 'Nothing was changed', message: `The password for ${a.platform} could not be decrypted, so the passphrase was left as it is.` });
          setBusy(false);
          return;
        }
      }

      const salt = generateSalt();
      const newKey = await deriveKey(next, salt, DEFAULT_ITERATIONS);
      const accounts = [];
      for (const p of plain) {
        const { cipher, iv } = await encryptSecret(newKey, p.text);
        accounts.push({ id: p.id, password_cipher: cipher, password_iv: iv });
      }
      const sentinel = await makeSentinel(newKey);

      await api.post('/vault/rotate', {
        salt, sentinel_cipher: sentinel.cipher, sentinel_iv: sentinel.iv, iterations: DEFAULT_ITERATIONS, accounts,
      });
      onDone(newKey, {
        exists: true, salt, sentinel_cipher: sentinel.cipher, sentinel_iv: sentinel.iv, iterations: DEFAULT_ITERATIONS,
      });
    } catch (err) {
      setNotice({ title: 'Nothing was changed', message: err.message || 'The passphrase could not be changed.' });
      setBusy(false);
    }
  }

  return (
    <Overlay
      title="Change Passphrase"
      onClose={onClose}
      width={440}
      footer={<FormFooter formId="vault-rotate" onClose={onClose} busy={busy} label="Change" />}
    >
      <form id="vault-rotate" onSubmit={handleSubmit}>
        <div className="form-row">
          <label className="form-label">Current</label>
          <input className="input" type="password" value={current} onChange={e => setCurrent(e.target.value)} autoFocus autoComplete="current-password" />
        </div>
        <div className="form-row">
          <label className="form-label">New</label>
          <input className="input" type="password" value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" />
        </div>
        <div className="form-row">
          <label className="form-label">Confirm</label>
          <input className="input" type="password" value={confirmNext} onChange={e => setConfirmNext(e.target.value)} autoComplete="new-password" />
        </div>
        {error && <div className="error-msg">{error}</div>}
      </form>
      {notice && (
        <ConfirmDialog
          title={notice.title}
          message={notice.message}
          confirmLabel="OK"
          cancelLabel={null}
          onConfirm={() => setNotice(null)}
          onCancel={() => setNotice(null)}
        />
      )}
    </Overlay>
  );
}

// ── Account card ──────────────────────────────────────────────────────────────

function AccountCard({ account, vaultKey, unlocked, today, onEdit, onDelete, onArchive, onNotice }) {
  const auth = authMeta(account.auth_method);
  const isSSO = auth.value !== 'password';
  const hasPassword = !isSSO && !!account.password_cipher;
  const paid = !!account.has_payment && Number(account.cost) > 0;
  const renewal = renewalInfo(account, today);

  const [revealed, setRevealed] = useState(null);
  const [copied, setCopied] = useState(false);

  // Locking hides every revealed password at once.
  useEffect(() => { if (!unlocked) setRevealed(null); }, [unlocked]);

  useEffect(() => {
    if (revealed === null) return undefined;
    const t = setTimeout(() => setRevealed(null), REVEAL_MS);
    return () => clearTimeout(t);
  }, [revealed]);

  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  async function toggleReveal() {
    if (revealed !== null) { setRevealed(null); return; }
    try {
      setRevealed(await decryptSecret(vaultKey, account.password_cipher, account.password_iv));
    } catch (_) {
      onNotice('Cannot decrypt', `The password for ${account.platform} could not be decrypted.`);
    }
  }

  async function copy() {
    let text;
    try {
      text = await decryptSecret(vaultKey, account.password_cipher, account.password_iv);
    } catch (_) {
      onNotice('Cannot decrypt', `The password for ${account.platform} could not be decrypted.`);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      scheduleClipboardClear(text);
      setCopied(true);
    } catch (_) {
      onNotice('Cannot copy', 'The browser did not allow writing to the clipboard.');
    }
  }

  const soon = renewal && renewal.days >= 0 ? renewal.days : null;
  const dotClass = soon === null ? null : soon <= 7 ? 'db-dot' : soon <= 30 ? 'db-dot muted' : null;

  return (
    <div className={`db-card acct-card ${account.archived ? 'is-muted' : ''}`}>
      <span className="db-avatar" title={auth.label} aria-label={auth.label}><auth.Icon size={17} /></span>
      <div className="db-main">
        <div className="db-name"><span>{account.platform}</span></div>
        {account.username && <div className="db-sub">{account.username}</div>}
        {(paid || renewal) && (
          <div className="db-meta">
            {paid && (
              <span className="db-chip" title={CYCLE_LABEL[account.billing_cycle]}>
                <Private>{money(account.currency, account.cost)}</Private>{CYCLE_SUFFIX[account.billing_cycle] || ''}
              </span>
            )}
            {renewal && (
              <span className="acct-date" title="Next renewal">
                {dotClass && <span className={dotClass} />}
                {fmtDate(renewal.next)}
              </span>
            )}
          </div>
        )}
        {hasPassword && (
          unlocked ? (
            <div className="acct-row">
              <span className={`acct-secret ${revealed === null ? 'is-masked' : ''}`}>
                {revealed === null ? '••••••••' : revealed}
              </span>
              <button type="button" className="db-iconbtn acct-secret-btn" onClick={toggleReveal} title={revealed === null ? 'Show' : 'Hide'} aria-label={revealed === null ? 'Show password' : 'Hide password'}>
                {revealed === null ? <Eye size={13} /> : <EyeOff size={13} />}
              </button>
              <button type="button" className="db-iconbtn acct-secret-btn" onClick={copy} title="Copy" aria-label="Copy password">
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
            </div>
          ) : (
            <div className="acct-row">
              <span className="acct-lock" title="Unlock to view" aria-label="Unlock to view"><Lock size={12} /></span>
            </div>
          )
        )}
      </div>
      <div className="db-actions">
        <IconLink href={account.url} title="Open"><ExternalLink size={15} /></IconLink>
        {account.notes && (
          <span className="db-iconbtn" title={account.notes} aria-label="Notes" style={{ cursor: 'default' }}>
            <StickyNote size={15} />
          </span>
        )}
        <IconMenu items={[
          { key: 'edit', Icon: Edit2, title: 'Edit', onClick: () => onEdit(account) },
          account.archived
            ? { key: 'unarchive', Icon: ArchiveRestore, title: 'Unarchive', onClick: () => onArchive(account) }
            : { key: 'archive', Icon: Archive, title: 'Archive', onClick: () => onArchive(account) },
          { key: 'delete', Icon: Trash2, title: 'Delete', danger: true, onClick: () => onDelete(account) },
        ]} />
      </div>
    </div>
  );
}

// ── Category section ──────────────────────────────────────────────────────────

function AccountSection({ category, list, archived, cardProps }) {
  const { Icon, title } = CATEGORY_META[category];
  return (
    <section className="mind-section">
      <div className="mind-section-head" title={title}>
        <Icon size={16} />
        {archived && <Archive size={14} className="muted" />}
        <span className="db-count"><span className="db-dot" />{list.length}</span>
      </div>
      {list.length === 0 ? (
        <div className="card db-empty"><Icon size={24} /></div>
      ) : (
        <div className="db-grid">
          {list.map(a => <AccountCard key={a.id} account={a} {...cardProps} />)}
        </div>
      )}
    </section>
  );
}

// ── Add / Edit overlay ────────────────────────────────────────────────────────

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
        setError('Cost must be between 0 and 1,000,000');
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
        // Otherwise the password fields are left out and the server keeps
        // whatever is stored.
      } else {
        // A sign in with another provider stores no password.
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

  const locked = !unlocked;

  return (
    <Overlay
      title={isEdit ? 'Edit Account' : 'New Account'}
      onClose={onClose}
      width={500}
      footer={<FormFooter formId="account-form" onClose={onClose} busy={saving} label={isEdit ? 'Save' : 'Create'} />}
    >
      <form id="account-form" onSubmit={handleSubmit}>
        <div className="form-row">
          <IconToggles options={CATEGORY_TOGGLES} value={form.category} onChange={v => set('category', v)} label="Category" />
        </div>
        <div className="form-row">
          <label className="form-label">Platform *</label>
          <input className="input" value={form.platform} onChange={e => set('platform', e.target.value)} autoFocus />
        </div>
        <div className="form-row">
          <label className="form-label">Username</label>
          <input className="input" value={form.username} onChange={e => set('username', e.target.value)} />
        </div>
        <div className="form-row">
          <label className="form-label">Login URL</label>
          <input className="input" value={form.url} onChange={e => set('url', e.target.value)} placeholder="https://" />
        </div>
        <div className="form-row">
          <label className="form-label">Notes</label>
          <textarea className="input" value={form.notes} onChange={e => set('notes', e.target.value)} style={{ resize: 'vertical', minHeight: '60px' }} />
        </div>

        <div className="form-row">
          <label className="form-label">Sign in</label>
          <select className="select" value={form.auth_method} onChange={e => set('auth_method', e.target.value)}>
            {AUTH_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>

        {form.auth_method === 'password' && (
          <div className="form-row">
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              Password
              {locked && <span className="acct-lock" title="Unlock to save a password"><Lock size={12} /></span>}
              {!locked && hasExistingPassword && !clearPassword && <span className="db-dot ink" title="Stored" />}
            </label>
            <div style={{ position: 'relative' }}>
              <input
                className="input"
                type={showPassword ? 'text' : 'password'}
                value={clearPassword ? '' : passwordInput}
                onChange={e => setPasswordInput(e.target.value)}
                placeholder={!locked && hasExistingPassword ? 'Keep stored' : ''}
                disabled={locked || clearPassword}
                autoComplete="new-password"
                style={{ paddingRight: !locked && !clearPassword ? '40px' : undefined }}
              />
              {!locked && !clearPassword && (
                <button
                  type="button"
                  className="db-iconbtn acct-secret-btn"
                  onClick={() => setShowPassword(v => !v)}
                  tabIndex={-1}
                  title={showPassword ? 'Hide' : 'Show'}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  style={{ position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)' }}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              )}
            </div>
            {!locked && hasExistingPassword && (
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
                <span className="db-sub" style={{ marginTop: 0 }}>Clear stored password</span>
              </label>
            )}
          </div>
        )}

        <div className="form-row">
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.has_payment}
              onChange={e => set('has_payment', e.target.checked)}
              style={{ accentColor: 'var(--color-ink)', width: 16, height: 16, flexShrink: 0 }}
            />
            <CreditCard size={15} />
            <span className="form-label" style={{ margin: 0 }}>Paid</span>
          </label>
        </div>

        {form.has_payment && (
          <>
            <div className="form-grid">
              <div className="form-row">
                <label className="form-label">Cost</label>
                <input className="input" type="number" min="0" max="1000000" step="0.01" value={form.cost} onChange={e => set('cost', e.target.value)} />
              </div>
              <div className="form-row">
                <label className="form-label">Currency</label>
                <select className="select" value={form.currency} onChange={e => set('currency', e.target.value)}>
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="form-grid">
              <div className="form-row">
                <label className="form-label">Cycle</label>
                <select className="select" value={form.billing_cycle} onChange={e => set('billing_cycle', e.target.value)}>
                  {BILLING_CYCLES.map(c => <option key={c} value={c}>{CYCLE_LABEL[c]}</option>)}
                </select>
              </div>
              <div className="form-row">
                <label className="form-label">Renewal</label>
                <DateField value={form.renewal_date} onChange={v => set('renewal_date', v)} />
              </div>
            </div>
          </>
        )}

        {error && <div className="error-msg">{error}</div>}
      </form>
    </Overlay>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MindAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [archivedAccounts, setArchivedAccounts] = useState([]);
  const [monthlySpend, setMonthlySpend] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [activeTab, setActiveTab] = useState('active');
  const [showModal, setShowModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState(null);

  // Vault key: in memory only, never written to storage.
  const [vaultKey, setVaultKey] = useState(null);
  const [vaultMeta, setVaultMeta] = useState(null);
  const [showVaultSetup, setShowVaultSetup] = useState(false);
  const [showVaultUnlock, setShowVaultUnlock] = useState(false);
  const [showRotate, setShowRotate] = useState(false);

  const unlocked = vaultKey !== null;
  const today = pristinaToday();

  const lockVault = useCallback(() => {
    setVaultKey(null);
    setShowRotate(false);
  }, []);

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
      setLoadErr('');
    } catch (err) {
      setLoadErr(err.message || 'Failed to load');
    }
  }

  useEffect(() => {
    async function init() {
      await loadData();
      try {
        setVaultMeta(await api.get('/vault/meta'));
      } catch (_) { /* the vault button stays hidden until the meta loads */ }
    }
    init().finally(() => setLoading(false));
  }, []);

  // Auto lock while unlocked: five idle minutes, or a minute with the tab
  // hidden. Checked on a one second tick and again when the tab comes back,
  // because a hidden tab's timers can run late.
  useEffect(() => {
    if (!unlocked) return undefined;
    let last = Date.now();
    let hiddenAt = null;
    let hiddenTimer = null;
    const bump = () => { last = Date.now(); };
    const activity = ['pointerdown', 'pointermove', 'keydown'];
    activity.forEach(ev => document.addEventListener(ev, bump, true));
    const idle = setInterval(() => {
      if (Date.now() - last >= IDLE_LOCK_MS) lockVault();
    }, Math.min(1000, IDLE_LOCK_MS));
    function onVisibility() {
      if (document.hidden) {
        hiddenAt = Date.now();
        clearTimeout(hiddenTimer);
        hiddenTimer = setTimeout(lockVault, HIDDEN_LOCK_MS);
        return;
      }
      clearTimeout(hiddenTimer);
      if (hiddenAt !== null && Date.now() - hiddenAt >= HIDDEN_LOCK_MS) lockVault();
      hiddenAt = null;
      bump();
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      activity.forEach(ev => document.removeEventListener(ev, bump, true));
      clearInterval(idle);
      clearTimeout(hiddenTimer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [unlocked, lockVault]);

  function showNotice(title, message) {
    setNotice({ title, message });
  }

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
    if (editingAccount) await api.put(`/mind-accounts/${editingAccount.id}`, data);
    else await api.post('/mind-accounts', data);
    await loadData();
  }

  async function runDelete() {
    const account = confirmDelete;
    setDeleting(true);
    try {
      await api.del(`/mind-accounts/${account.id}`);
      setConfirmDelete(null);
      await loadData();
    } catch (err) {
      setConfirmDelete(null);
      showNotice('Not deleted', err.message || 'The account could not be deleted.');
    }
    setDeleting(false);
  }

  async function handleArchive(account) {
    try {
      await api.post(`/mind-accounts/${account.id}/${account.archived ? 'unarchive' : 'archive'}`, {});
      await loadData();
    } catch (err) {
      showNotice('Not updated', err.message || 'The account could not be updated.');
    }
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

  async function handleRotated(key, meta) {
    setVaultKey(key);
    setVaultMeta(meta);
    setShowRotate(false);
    await loadData();
  }

  if (loading) return <div className="loading">Loading...</div>;

  const byCategory = (cat, list) => list.filter(a => a.category === cat);

  const totals = (monthlySpend && monthlySpend.totals) || {};
  const currencies = Object.keys(totals).sort(currencyOrder);
  const paidActive = accounts.filter(a => a.has_payment && Number(a.cost) > 0);
  const upcoming = paidActive.map(a => renewalInfo(a, today)).filter(r => r && r.days >= 0);
  const due30 = upcoming.filter(r => r.days <= 30).length;
  const dueSoon = upcoming.some(r => r.days <= 7);

  const cardProps = {
    vaultKey, unlocked, today,
    onEdit: openEdit,
    onDelete: setConfirmDelete,
    onArchive: handleArchive,
    onNotice: showNotice,
  };

  let vaultButton = null;
  if (vaultMeta) {
    if (!vaultMeta.exists) {
      vaultButton = (
        <button type="button" className="db-iconbtn lg" onClick={() => setShowVaultSetup(true)} title="Set up vault" aria-label="Set up vault">
          <ShieldPlus size={17} />
        </button>
      );
    } else if (unlocked) {
      vaultButton = (
        <>
          <button type="button" className="db-iconbtn lg" onClick={() => setShowRotate(true)} title="Change passphrase" aria-label="Change passphrase">
            <LockKeyhole size={17} />
          </button>
          <button type="button" className="db-iconbtn lg" onClick={lockVault} title="Lock" aria-label="Lock vault" style={{ color: 'var(--color-ink)' }}>
            <Unlock size={17} />
          </button>
        </>
      );
    } else {
      vaultButton = (
        <button type="button" className="db-iconbtn lg" onClick={() => setShowVaultUnlock(true)} title="Unlock" aria-label="Unlock vault">
          <Lock size={17} />
        </button>
      );
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Accounts</div>
        <div className="db-actions" style={{ gap: '8px' }}>
          {vaultButton}
          <button className="btn btn-primary" onClick={openAdd} title="New account" aria-label="New account">
            <Plus size={16} />
          </button>
        </div>
      </div>

      {loadErr && <div className="error-msg" style={{ marginBottom: '12px' }}>{loadErr}</div>}

      <div className="card mind-summary">
        <span className="db-avatar sm"><CreditCard size={15} /></span>
        {(currencies.length ? currencies : ['EUR']).map(cur => (
          <span key={cur}>
            <span className="db-money"><Private>{money(cur, totals[cur] || 0)}</Private></span>
            <span className="cycle">/mo</span>
          </span>
        ))}
        <span className="spacer" />
        <Ring
          value={due30}
          max={Math.max(paidActive.length, 1)}
          size={34}
          color={dueSoon ? 'var(--color-ember)' : 'var(--color-ink)'}
          title={`${due30} renewal${due30 === 1 ? '' : 's'} in 30 days`}
        >
          {String(due30)}
        </Ring>
      </div>

      <div className="mind-toolbar">
        <IconToggles options={TABS} value={activeTab} onChange={setActiveTab} label="Show" />
      </div>

      {activeTab === 'active' && (
        accounts.length === 0 ? (
          <div className="card db-empty"><KeyRound size={28} /></div>
        ) : (
          CATEGORIES.map(cat => (
            <AccountSection key={cat} category={cat} list={byCategory(cat, accounts)} cardProps={cardProps} />
          ))
        )
      )}

      {activeTab === 'archived' && (
        archivedAccounts.length === 0 ? (
          <div className="card db-empty"><Archive size={28} /></div>
        ) : (
          CATEGORIES.filter(cat => byCategory(cat, archivedAccounts).length > 0).map(cat => (
            <AccountSection key={cat} category={cat} archived list={byCategory(cat, archivedAccounts)} cardProps={cardProps} />
          ))
        )
      )}

      {showModal && (
        <AccountModal account={editingAccount} vaultKey={vaultKey} unlocked={unlocked} onSave={handleSave} onClose={closeModal} />
      )}
      {showVaultSetup && (
        <VaultSetupModal onSetup={handleVaultSetup} onClose={() => setShowVaultSetup(false)} />
      )}
      {showVaultUnlock && vaultMeta?.exists && (
        <VaultUnlockModal vaultMeta={vaultMeta} onUnlock={handleVaultUnlock} onClose={() => setShowVaultUnlock(false)} />
      )}
      {showRotate && unlocked && vaultMeta?.exists && (
        <ChangePassphraseModal vaultMeta={vaultMeta} onDone={handleRotated} onClose={() => setShowRotate(false)} />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${confirmDelete.platform}?`}
          confirmLabel="Delete"
          tone="danger"
          busy={deleting}
          onConfirm={runDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {notice && (
        <ConfirmDialog
          title={notice.title}
          message={notice.message}
          confirmLabel="OK"
          cancelLabel={null}
          onConfirm={() => setNotice(null)}
          onCancel={() => setNotice(null)}
        />
      )}
    </div>
  );
}
