import React from 'react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { fmt } from '../api';
import { Private, usePrivacy } from '../context/PrivacyContext';

// The combined revenue, cost and project profit chart, shared by the Dashboard
// trend widget and the Finances overview. Series colours come from the shared
// palette tokens (--chart-revenue, --chart-expenses, --chart-profit).
//
// data rows carry `month` (axis label) plus the three series keys. costKey
// names the cost series: the Dashboard plots expenses, Finances plots total
// costs (expenses plus crew).

function compactCurrency(v) {
  const n = Number(v) || 0;
  const abs = Math.abs(n);
  if (abs >= 1000) return `€${(n / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  return `€${Math.round(n)}`;
}

// Privacy aware Y axis tick. The tick text lives inside an SVG, so it cannot be
// wrapped in Private; it blurs with the same filter, driven by the shared
// privacy state.
function PrivacyYTick({ x, y, payload }) {
  const { hidden } = usePrivacy();
  return (
    <text
      x={x} y={y} dy={3} textAnchor="end" fontSize={10} fill="var(--color-mid-gray)"
      style={{ filter: hidden ? 'blur(6px)' : 'none', transition: 'filter 0.25s ease' }}
    >
      {compactCurrency(payload.value)}
    </text>
  );
}

function ChartTooltip({ active, payload, label, names }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--color-surface-alt)', border: '1px solid var(--color-hairline)',
      borderRadius: '10px', padding: '10px 14px', fontSize: '12px',
    }}>
      <div style={{ color: 'var(--color-mid-gray)', marginBottom: '6px' }}>{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color || p.stroke, display: 'inline-block' }} />
          <span style={{ color: 'var(--color-mid-gray)', minWidth: 60 }}>{names[p.dataKey] || p.name}</span>
          <span style={{ color: 'var(--color-ink)', fontWeight: 600 }}><Private>{fmt(p.value)}</Private></span>
        </div>
      ))}
    </div>
  );
}

export default function TrendChart({ data, costKey = 'expenses', costLabel = 'Expenses', height = 220 }) {
  const names = { revenue: 'Revenue', [costKey]: costLabel, profit: 'Project profit' };
  return (
    <>
      <div className="trend-legend">
        <span className="trend-legend-item"><span className="trend-dot" style={{ background: 'var(--chart-revenue)' }} /> Revenue</span>
        <span className="trend-legend-item"><span className="trend-dot" style={{ background: 'var(--chart-expenses)' }} /> {costLabel}</span>
        <span className="trend-legend-item"><span className="trend-dot" style={{ background: 'var(--chart-profit)' }} /> Project profit</span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            {/* Revenue: the loudest series, a solid heavy stroke over a
                subtle fill so the line stays dominant. */}
            <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="var(--chart-revenue)" stopOpacity={0.20} />
              <stop offset="95%" stopColor="var(--chart-revenue)" stopOpacity={0.02} />
            </linearGradient>
            {/* Costs: quieter, a thin stroke over a barely there fill, so it
                reads as a different weight even where it overlaps. */}
            <linearGradient id="expGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="var(--chart-expenses)" stopOpacity={0.12} />
              <stop offset="95%" stopColor="var(--chart-expenses)" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--color-hairline)" strokeOpacity={0.45} />
          <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--color-mid-gray)' }} axisLine={false} tickLine={false} />
          <YAxis width={44} tick={<PrivacyYTick />} axisLine={false} tickLine={false} />
          <Tooltip content={<ChartTooltip names={names} />} />
          {/* Colour is the primary cue; the weight and fill differences and the
              dashed profit line are secondary cues so the chart still reads for
              anyone who cannot separate the hues. */}
          <Area type="monotone" dataKey="revenue" stroke="var(--chart-revenue)" strokeWidth={2.5} fill="url(#revGrad)" dot={false} />
          <Area type="monotone" dataKey={costKey} stroke="var(--chart-expenses)" strokeWidth={1.25} fill="url(#expGrad)" dot={false} />
          <Line type="monotone" dataKey="profit" stroke="var(--chart-profit)" strokeWidth={2} strokeDasharray="5 3" fill="none" dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </>
  );
}
