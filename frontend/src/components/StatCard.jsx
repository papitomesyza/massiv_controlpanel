import React, { useId } from 'react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';

function SparkLine({ data, dataKey, color, uid }) {
  if (!data || data.length < 2) return null;
  const gradId = `sg${uid}${dataKey}`;
  return (
    <div className="stat-sparkline-wrap" style={{ height: 44, marginLeft: -4, marginRight: -4 }}>
      <ResponsiveContainer width="100%" height={44}>
        <AreaChart data={data} margin={{ top: 2, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${gradId})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function RingGauge({ percent, color }) {
  const size = 54;
  const sw = 5;
  const r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const val = Math.min(Math.max(percent || 0, 0), 100);
  const filled = (val / 100) * circ;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size/2} cy={size/2} r={r} fill="none"
        stroke="rgba(255,255,255,0.08)" strokeWidth={sw} />
      <circle cx={size/2} cy={size/2} r={r} fill="none"
        stroke={color || '#723CEB'} strokeWidth={sw}
        strokeDasharray={`${filled} ${circ - filled}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ transition: 'stroke-dasharray 0.3s ease' }}
      />
    </svg>
  );
}

export default function StatCard({
  label, value, sub, danger, warn, icon, onClick, gradient,
  sparkline, sparklineKey,
  ring, ringColor,
  iconTint,
}) {
  const uid = useId().replace(/[^a-z0-9]/gi, '');
  const valueStyle = warn && !danger ? { color: '#FF902F' } : undefined;
  const sparkColor = gradient
    ? 'rgba(255,255,255,0.75)'
    : (danger ? '#FF4444' : '#723CEB');

  return (
    <div
      className={`card stat-card${onClick ? ' stat-card-clickable' : ''}${gradient ? ' card-gradient' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
    >
      {icon && ring === undefined && (
        <div className={`stat-icon-wrap${iconTint ? ` ic-${iconTint}` : ''}`}>{icon}</div>
      )}
      {ring !== undefined && (
        <div style={{ position: 'absolute', top: '18px', right: '18px' }}>
          <RingGauge percent={ring} color={ringColor || '#723CEB'} />
        </div>
      )}
      <div className="stat-label">{label}</div>
      <div className={`stat-value${danger ? ' danger' : ''}`} style={valueStyle}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
      {sparkline && sparklineKey && (
        <SparkLine data={sparkline} dataKey={sparklineKey} color={sparkColor} uid={uid} />
      )}
    </div>
  );
}
