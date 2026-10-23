import React, { useEffect, useState } from 'react';
import { api, fmt, fmtDate } from '../api';

// Read-only project list for the finance login: who the work is for, where it
// stands, and the money that matters for invoicing (agreed value, received,
// still outstanding). Cost and margin stay on Andi's own Finances page.
export default function ProjectList() {
  const [projects, setProjects] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/projects')
      .then(setProjects)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const rows = (Array.isArray(projects) ? projects : [])
    .filter(p => (p.status || '') !== 'completed');

  const money = v => (v ? fmt(v) : '-');

  const totals = rows.reduce((acc, p) => {
    const value = Number(p.agreed_budget) || Number(p.client_budget) || 0;
    const received = Number(p.total_received) || 0;
    acc.value += value;
    acc.received += received;
    acc.outstanding += Math.max(0, value - received);
    return acc;
  }, { value: 0, received: 0, outstanding: 0 });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Ongoing Projects</h1>
          <p className="page-subtitle">Read only</p>
        </div>
      </div>

      {error && <div className="error-msg">{error}</div>}
      {loading ? <div>Loading...</div> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Project</th>
                <th style={{ textAlign: 'left' }}>Client</th>
                <th style={{ textAlign: 'left' }}>Category</th>
                <th style={{ textAlign: 'left' }}>Phase</th>
                <th style={{ textAlign: 'left' }}>Deadline</th>
                <th style={{ textAlign: 'right' }}>Value</th>
                <th style={{ textAlign: 'right' }}>Received</th>
                <th style={{ textAlign: 'right' }}>Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => {
                const value = Number(p.agreed_budget) || Number(p.client_budget) || 0;
                const received = Number(p.total_received) || 0;
                const outstanding = Math.max(0, value - received);
                return (
                  <tr key={p.id}>
                    <td>{p.title || p.name}</td>
                    <td>{p.client_name || ''}</td>
                    <td>{p.category_name || ''}</td>
                    <td>{p.current_phase || ''}</td>
                    <td>{fmtDate(p.deadline)}</td>
                    <td style={{ textAlign: 'right' }}>{money(value)}</td>
                    <td style={{ textAlign: 'right' }}>{money(received)}</td>
                    <td style={{ textAlign: 'right' }}>{money(value ? outstanding : 0)}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={8}>Nothing ongoing.</td></tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr style={{ fontWeight: 600 }}>
                  <td colSpan={5}>Total</td>
                  <td style={{ textAlign: 'right' }}>{fmt(totals.value)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(totals.received)}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(totals.outstanding)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
