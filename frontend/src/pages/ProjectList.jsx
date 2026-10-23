import React, { useEffect, useState } from 'react';
import { api } from '../api';

// Read-only project list for the finance login. /projects carries budgets and
// costs, but this view shows only who the work is for and where it stands.
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
              </tr>
            </thead>
            <tbody>
              {rows.map(p => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.client_name || ''}</td>
                  <td>{p.category_name || ''}</td>
                  <td>{p.current_phase || ''}</td>
                  <td>{p.deadline || ''}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5}>Nothing ongoing.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
