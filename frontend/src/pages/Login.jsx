import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAgency } from '../context/AgencyContext';

export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { name: agencyName, tagline, logo } = useAgency();

  async function handleLogin() {
    if (!password) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.post('/auth/login', { password });
      localStorage.setItem('massiv_auth', data.token);
      navigate('/dashboard');
    } catch (e) {
      setError(e.message || 'Invalid password');
    } finally {
      setLoading(false);
    }
  }

  function onKey(e) { if (e.key === 'Enter') handleLogin(); }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#131313',
      padding: '20px',
    }}>
      <div style={{ width: '100%', maxWidth: '380px' }}>
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          {logo ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', marginBottom: '20px' }}>
              <img
                src={logo}
                alt={agencyName}
                style={{
                  maxHeight: '64px',
                  width: 'auto',
                  objectFit: 'contain',
                }}
              />
            </div>
          ) : (
            <>
              <div style={{
                width: '60px',
                height: '60px',
                borderRadius: '18px',
                background: 'var(--gradient-card)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 20px',
                boxShadow: '0 8px 32px rgba(199,255,46,0.25)',
                fontSize: '24px',
                fontWeight: 800,
                color: '#0F0F0F',
                letterSpacing: '-1px',
              }}>
                {(agencyName || 'M').charAt(0).toUpperCase()}
              </div>
              <h1 style={{ fontSize: '32px', fontWeight: 700, letterSpacing: '-0.5px', marginBottom: '8px', color: '#ffffff' }}>
                {agencyName}
              </h1>
              <p style={{ color: '#888888', fontSize: '14px' }}>{tagline || 'Creative Agency OS'}</p>
            </>
          )}
        </div>

        <div className="card card-pad">
          <div className="form-row">
            <label className="form-label">Password</label>
            <input
              type="password"
              className="input"
              placeholder="Enter password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={onKey}
              autoFocus
            />
            {error && <div className="error-msg">{error}</div>}
          </div>
          <button
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', marginTop: '4px' }}
            onClick={handleLogin}
            disabled={loading}
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </div>

        <p style={{ textAlign: 'center', color: '#444444', fontSize: '11px', marginTop: '24px' }}>
          built by year28
        </p>
      </div>
    </div>
  );
}
