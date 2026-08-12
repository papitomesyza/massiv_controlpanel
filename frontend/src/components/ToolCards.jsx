import React from 'react';
import { useNavigate } from 'react-router-dom';

// The card grid both Tools pages are built from. One card per tool: a title, a
// one-line description and an icon. Disabled cards stay visible so what is
// coming later is legible, but they never navigate.
export function ToolCard({ icon: Icon, title, description, to, disabled, badge }) {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      className={`tool-card${disabled ? ' is-disabled' : ''}`}
      onClick={() => { if (!disabled && to) navigate(to); }}
      disabled={disabled}
      aria-disabled={disabled ? 'true' : undefined}
    >
      <span className="tool-card-icon"><Icon size={20} /></span>
      <span className="tool-card-title">
        {title}
        {badge && <span className="tool-card-badge">{badge}</span>}
      </span>
      <span className="tool-card-desc">{description}</span>
    </button>
  );
}

export function ToolCardGrid({ children }) {
  return <div className="tool-card-grid">{children}</div>;
}
