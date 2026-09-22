import React, { useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { fmt } from '../api';
import { Private } from '../context/PrivacyContext';

// The donut used by the Dashboard expenses widget and the Finances revenue by
// category view. Arcs take the shared eight hue categorical palette (see
// index.css); the slices have no order, so each takes the next hue, cycling if
// there are ever more slices than hues. No text is printed on the arcs: amounts
// appear on hover only, through the privacy aware Private wrapper.
const CATEGORICAL = Array.from({ length: 8 }, (_, i) => `var(--cat-${i + 1})`);
export const donutColor = i => CATEGORICAL[i % CATEGORICAL.length];

export default function Donut({ data, valueKey = 'total', nameKey = 'name', colorFor = donutColor, height = 240 }) {
  const [active, setActive] = useState(null); // hovered arc / legend row index
  const total = data.reduce((s, e) => s + (Number(e[valueKey]) || 0), 0);

  return (
    <div className="donut-2col">
      <div className="donut-chart">
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie
              data={data}
              dataKey={valueKey}
              nameKey={nameKey}
              innerRadius={68}
              outerRadius={100}
              paddingAngle={1.5}
              stroke="var(--surface-card)"
              strokeWidth={2}
              onMouseEnter={(_, i) => setActive(i)}
              onMouseLeave={() => setActive(null)}
            >
              {data.map((e, i) => (
                <Cell
                  key={i}
                  fill={colorFor(i, e)}
                  fillOpacity={active === null || active === i ? 1 : 0.3}
                  style={{ transition: 'fill-opacity 0.15s ease' }}
                />
              ))}
            </Pie>
            <Tooltip content={<DonutTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center">
          <span className="donut-center-label">Total</span>
          <span className="donut-center-value"><Private>{fmt(total)}</Private></span>
        </div>
      </div>
      <ul className="donut-legend">
        {data.map((e, i) => (
          <li
            key={i}
            className={`donut-legend-item${active === i ? ' active' : ''}`}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
          >
            <span className="donut-dot" style={{ background: colorFor(i, e) }} />
            <span className="donut-legend-name">{e[nameKey]}</span>
            {active === i && (
              <span className="donut-legend-amt"><Private>{fmt(e[valueKey])}</Private></span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DonutTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0];
  return (
    <div style={{
      background: 'var(--color-surface-alt)', border: '1px solid var(--color-hairline)',
      borderRadius: '10px', padding: '8px 12px', fontSize: '12px',
    }}>
      <div style={{ color: 'var(--color-mid-gray)', marginBottom: '3px' }}>{row.name}</div>
      <div style={{ color: 'var(--color-ink)', fontWeight: 600 }}><Private>{fmt(row.value)}</Private></div>
    </div>
  );
}
