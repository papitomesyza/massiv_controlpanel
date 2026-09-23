import React from 'react';

// A small progress ring: one arc for value against max on a hairline track.
// Used by the Clients, Crew and their detail pages for received against
// agreed, and paid against agreed, where a full donut would be too heavy.
// Anything passed as children sits in the centre.
export default function Ring({
  value = 0,
  max = 0,
  size = 28,
  stroke = 3,
  color = 'var(--color-ink)',
  track = 'var(--color-hairline)',
  title,
  children,
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const mid = size / 2;
  return (
    <span className="ring" style={{ width: size, height: size }} title={title}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={mid} cy={mid} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        {frac > 0 && (
          <circle
            cx={mid} cy={mid} r={r} fill="none" stroke={color} strokeWidth={stroke}
            strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)}
            transform={`rotate(-90 ${mid} ${mid})`}
            style={{ transition: 'stroke-dashoffset 0.3s ease' }}
          />
        )}
      </svg>
      {children && <span className="ring-center">{children}</span>}
    </span>
  );
}
