import React from 'react';

export default function StatCard({ label, value, sub, danger, warn, icon, onClick, gradient }) {
  const valueStyle = warn && !danger ? { color: '#FF902F' } : undefined;
  return (
    <div
      className={`card stat-card${onClick ? ' stat-card-clickable' : ''}${gradient ? ' card-gradient' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
    >
      {icon && <div className="stat-icon-wrap">{icon}</div>}
      <div className="stat-label">{label}</div>
      <div className={`stat-value${danger ? ' danger' : ''}`} style={valueStyle}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
