import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Receipt, CheckCircle, Lock, XCircle, Upload, X, FileText } from 'lucide-react';

const BASE = '/api';

async function publicGet(path) {
  const res = await fetch(`${BASE}${path}`);
  return res.json();
}

async function publicPost(path, formData) {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', body: formData });
  return res.json();
}

export default function PublicExpense() {
  const { token } = useParams();
  const [state, setState] = useState('loading'); // loading | valid | expired | invalid
  const [projectTitle, setProjectTitle] = useState('');
  const [categories, setCategories] = useState([]);
  const [agency, setAgency] = useState({ agency_name: null, agency_logo_base64: null });
  const [form, setForm] = useState({ submitted_by: '', category: '', custom_category: '', amount: '', description: '' });
  const [file, setFile] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(null); // { amount, category }
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  useEffect(() => {
    Promise.all([
      publicGet(`/public/expense/${token}`),
      publicGet('/public/expense-categories'),
      publicGet('/settings/agency-public'),
    ]).then(([validation, cats, ag]) => {
      setAgency(ag);
      setCategories(cats);
      if (!validation.valid) {
        setState(validation.reason === 'expired' ? 'expired' : 'invalid');
        if (validation.project_title) setProjectTitle(validation.project_title);
      } else {
        setProjectTitle(validation.project_title || '');
        setState('valid');
      }
    }).catch(() => setState('invalid'));
  }, [token]);

  function f(k, v) { setForm(p => ({ ...p, [k]: v })); }

  function handleFile(chosen) {
    if (!chosen) return;
    setFile(chosen);
    if (chosen.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = e => setFilePreview(e.target.result);
      reader.readAsDataURL(chosen);
    } else {
      setFilePreview(null);
    }
  }

  function removeFile() {
    setFile(null);
    setFilePreview(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.amount) { setError('Amount is required'); return; }
    setError('');
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('category', form.category || 'Miscellaneous');
      if (form.category === 'custom') fd.append('custom_category', form.custom_category);
      fd.append('amount', form.amount);
      fd.append('description', form.description);
      if (form.submitted_by) fd.append('submitted_by', form.submitted_by);
      if (file) fd.append('invoice_image', file);

      const res = await publicPost(`/public/expense/${token}`, fd);
      if (res.success) {
        setSubmitted({
          amount: form.amount,
          category: form.category === 'custom' ? (form.custom_category || 'Custom') : (form.category || 'Miscellaneous'),
        });
        setForm({ submitted_by: form.submitted_by, category: '', custom_category: '', amount: '', description: '' });
        removeFile();
      } else {
        setError(res.error || 'Submission failed');
      }
    } catch {
      setError('Submission failed. Please try again.');
    }
    setSubmitting(false);
  }

  function resetForAnother() {
    setSubmitted(null);
  }

  const cardStyle = {
    background: 'var(--color-surface-alt)',
    borderRadius: '24px',
    padding: '32px',
    width: '100%',
    maxWidth: '480px',
    boxShadow: '0 8px 40px var(--overlay-07)',
  };

  const inputStyle = {
    width: '100%',
    background: 'var(--surface-card)',
    border: '1px solid var(--color-hairline)',
    borderRadius: '10px',
    color: 'var(--color-ink)',
    padding: '14px 16px',
    fontSize: '16px',
    outline: 'none',
    boxSizing: 'border-box',
    minHeight: '52px',
    WebkitAppearance: 'none',
  };

  const labelStyle = {
    display: 'block',
    color: 'var(--color-mid-gray)',
    fontSize: '13px',
    marginBottom: '6px',
    fontWeight: 500,
  };

  const rowStyle = { marginBottom: '16px' };

  const gradientBtn = {
    width: '100%',
    background: 'var(--gradient-card)',
    color: 'var(--accent-contrast)',
    border: 'none',
    borderRadius: '10px',
    padding: '16px',
    fontSize: '16px',
    fontWeight: 700,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    minHeight: '54px',
  };

  const page = {
    minHeight: '100vh',
    background: 'var(--surface-input-fill)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 16px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  };

  if (state === 'loading') {
    return (
      <div style={page}>
        <div style={{ ...cardStyle, textAlign: 'center' }}>
          <div style={{ color: 'var(--color-mid-gray)', fontSize: '15px' }}>Verifying access...</div>
        </div>
      </div>
    );
  }

  if (state === 'expired') {
    return (
      <div style={page}>
        <div style={{ ...cardStyle, textAlign: 'center' }}>
          <Lock size={40} color="var(--color-faint)" style={{ marginBottom: '16px' }} />
          <div style={{ color: 'var(--color-ink)', fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>
            This expense link has expired.
          </div>
          <div style={{ color: 'var(--color-mid-gray)', fontSize: '14px' }}>
            {projectTitle ? `"${projectTitle}" has been marked as completed.` : 'This project has been marked as completed.'}
          </div>
        </div>
      </div>
    );
  }

  if (state === 'invalid') {
    return (
      <div style={page}>
        <div style={{ ...cardStyle, textAlign: 'center' }}>
          <XCircle size={40} color="var(--color-ember)" style={{ marginBottom: '16px' }} />
          <div style={{ color: 'var(--color-ink)', fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>
            This link is no longer valid.
          </div>
          <div style={{ color: 'var(--color-mid-gray)', fontSize: '14px' }}>
            Contact your project manager for assistance.
          </div>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div style={page}>
        <div style={{ ...cardStyle, textAlign: 'center' }}>
          <div style={{ animation: 'scaleIn 0.3s ease-out' }}>
            <CheckCircle size={56} color="var(--color-ink)" style={{ marginBottom: '16px' }} />
          </div>
          <div style={{ color: 'var(--color-ink)', fontSize: '20px', fontWeight: 700, marginBottom: '8px' }}>
            Expense Submitted
          </div>
          <div style={{ color: 'var(--color-mid-gray)', fontSize: '14px', marginBottom: '4px' }}>
            €{parseFloat(submitted.amount).toFixed(2)} · {submitted.category}
          </div>
          <div style={{ color: 'var(--color-mid-gray)', fontSize: '13px', marginBottom: '28px' }}>
            {projectTitle}
          </div>
          <button onClick={resetForAnother} style={{ ...gradientBtn, background: 'var(--surface-card)', border: '1px solid var(--color-hairline)' }}>
            Submit Another Expense
          </button>
        </div>
        <style>{`@keyframes scaleIn { from { transform: scale(0.5); opacity: 0; } to { transform: scale(1); opacity: 1; } }`}</style>
      </div>
    );
  }

  return (
    <div style={page}>
      <div style={cardStyle}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          {agency.agency_logo_base64 ? (
            <img src={agency.agency_logo_base64} alt="Agency" style={{ height: '40px', objectFit: 'contain', marginBottom: '12px' }} />
          ) : agency.agency_name ? (
            <div style={{ color: 'var(--color-ink)', fontWeight: 800, fontSize: '18px', marginBottom: '12px' }}>{agency.agency_name}</div>
          ) : null}
          <div style={{ color: 'var(--color-ink)', fontWeight: 700, fontSize: '18px' }}>{projectTitle}</div>
          <div style={{ color: 'var(--color-mid-gray)', fontSize: '13px', marginTop: '4px' }}>Expense Submission</div>
        </div>

        <form onSubmit={submit}>
          <div style={rowStyle}>
            <label style={labelStyle}>Submitted By</label>
            <input
              style={inputStyle}
              placeholder="Your name (optional)"
              value={form.submitted_by}
              onChange={e => f('submitted_by', e.target.value)}
            />
          </div>

          <div style={rowStyle}>
            <label style={labelStyle}>Category</label>
            <select
              style={{ ...inputStyle, appearance: 'none' }}
              value={form.category}
              onChange={e => f('category', e.target.value)}
            >
              <option value="">Select category</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
              <option value="custom">Custom...</option>
            </select>
          </div>

          {form.category === 'custom' && (
            <div style={rowStyle}>
              <label style={labelStyle}>Custom Category</label>
              <input
                style={inputStyle}
                placeholder="Enter category name"
                value={form.custom_category}
                onChange={e => f('custom_category', e.target.value)}
              />
            </div>
          )}

          <div style={rowStyle}>
            <label style={labelStyle}>Amount (€) *</label>
            <input
              type="number"
              inputMode="decimal"
              style={{ ...inputStyle, fontSize: '22px', fontWeight: 700 }}
              placeholder="0.00"
              step="0.01"
              min="0"
              value={form.amount}
              onChange={e => f('amount', e.target.value)}
              required
            />
          </div>

          <div style={rowStyle}>
            <label style={labelStyle}>Description</label>
            <textarea
              style={{ ...inputStyle, minHeight: '90px', resize: 'vertical' }}
              placeholder="What was this expense for?"
              value={form.description}
              onChange={e => f('description', e.target.value)}
            />
          </div>

          {/* File upload */}
          <div style={rowStyle}>
            <label style={labelStyle}>Invoice / Receipt</label>
            {file ? (
              <div style={{ background: 'var(--surface-card)', border: '1px solid var(--color-hairline)', borderRadius: '10px', padding: '12px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                {filePreview ? (
                  <img src={filePreview} alt="preview" style={{ width: '56px', height: '56px', borderRadius: '6px', objectFit: 'cover', flexShrink: 0 }} />
                ) : (
                  <FileText size={32} color="var(--color-mid-gray)" style={{ flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ color: 'var(--color-ink)', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
                  <div style={{ color: 'var(--color-mid-gray)', fontSize: '12px' }}>{(file.size / 1024).toFixed(0)} KB</div>
                </div>
                <button type="button" onClick={removeFile} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-mid-gray)', padding: '4px' }}>
                  <X size={18} />
                </button>
              </div>
            ) : (
              <div
                onClick={() => fileRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
                style={{
                  border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--color-hairline)'}`,
                  borderRadius: '10px',
                  padding: '24px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: dragOver ? 'var(--overlay-02)' : 'transparent',
                  transition: 'all 0.15s',
                }}
              >
                <Upload size={24} color="var(--color-mid-gray)" style={{ marginBottom: '8px' }} />
                <div style={{ color: 'var(--color-mid-gray)', fontSize: '14px' }}>Tap to upload or drag & drop</div>
                <div style={{ color: 'var(--color-mid-gray)', fontSize: '12px', marginTop: '4px' }}>JPG, PNG, WebP, PDF · Max 10MB</div>
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp,application/pdf"
              style={{ display: 'none' }}
              onChange={e => handleFile(e.target.files[0])}
            />
          </div>

          {error && <div style={{ color: 'var(--color-ember)', fontSize: '13px', marginBottom: '12px' }}>{error}</div>}

          <button type="submit" style={gradientBtn} disabled={submitting}>
            <Receipt size={18} />
            {submitting ? 'Submitting...' : 'Submit Expense'}
          </button>
        </form>
      </div>
    </div>
  );
}
