import React from 'react';
import { fmt } from '../api';
import { usePrivacy } from '../context/PrivacyContext';

// Small pieces shared by the Database pages (Clients, Crew and their detail
// pages): contact links, the project status dot and the icon toggle row.

export function waUrl(phone) {
  if (!phone) return null;
  const clean = String(phone).replace(/\D/g, '');
  return clean ? `https://wa.me/${clean}` : null;
}

export function mailUrl(email) {
  return email ? `mailto:${email}` : null;
}

export function telUrl(phone) {
  if (!phone) return null;
  const clean = String(phone).replace(/[^\d+]/g, '');
  return clean ? `tel:${clean}` : null;
}

// A socials value is free text. When it reads as a link it opens; otherwise
// the icon only carries it as a tooltip.
export function socialUrl(socials) {
  if (!socials) return null;
  const s = String(socials).trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(s)) return `https://${s}`;
  return null;
}

// Money inside a tooltip follows privacy mode like every Private figure: while
// figures are hidden the tooltip keeps only its words.
export function useMoneyTip() {
  const { hidden } = usePrivacy();
  return (label, v) => (hidden ? label : `${label} ${fmt(v)}`);
}

// Same status hues as the Projects rows and the timeline.
const STATUS_HUE = {
  'development':     'var(--tl-hue-development)',
  'pre-production':  'var(--tl-hue-pre-production)',
  'production':      'var(--tl-hue-production)',
  'post-production': 'var(--tl-hue-post-production)',
};
const STATUS_LABEL = {
  'development':     'Development',
  'pre-production':  'Pre-Production',
  'production':      'Production',
  'post-production': 'Post-Production',
  'completed':       'Completed',
};

export function StatusDot({ status, size = 9 }) {
  const title = STATUS_LABEL[status] || status || undefined;
  if (status === 'completed') {
    return (
      <span
        className="status-dot" title={title}
        style={{ width: size, height: size, background: 'transparent', border: '1.5px solid var(--color-hairline-strong)' }}
      />
    );
  }
  return (
    <span
      className="status-dot" title={title}
      style={{ width: size, height: size, background: STATUS_HUE[status] || 'var(--color-hairline-strong)' }}
    />
  );
}

// A row of icon-only toggles. options: [{ key, Icon, title }].
export function IconToggles({ options, value, onChange, label }) {
  return (
    <div className="toggle-group" role="group" aria-label={label}>
      {options.map(({ key, Icon, title }) => (
        <button
          key={key}
          type="button"
          className={`toggle-btn toggle-icon ${value === key ? 'active' : ''}`}
          onClick={() => onChange(key)}
          title={title}
          aria-label={title}
          aria-pressed={value === key}
        >
          <Icon size={15} />
        </button>
      ))}
    </div>
  );
}

// An icon-only action that stops the click from reaching the card under it.
export function IconLink({ href, title, children, external = true, className = '' }) {
  if (!href) return null;
  return (
    <a
      href={href}
      className={`db-iconbtn ${className}`}
      title={title}
      aria-label={title}
      onClick={e => e.stopPropagation()}
      onKeyDown={e => e.stopPropagation()}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {children}
    </a>
  );
}
