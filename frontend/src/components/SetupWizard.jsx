import React, { useState } from 'react';
import { X, Check, ArrowRight } from 'lucide-react';
import { api } from '../api';

const IDENTITY_OPTIONS = [
  {
    value: 'agency',
    label: 'Agency / Studio',
    sub: 'Team-based, multiple projects, full production pipeline.',
  },
  {
    value: 'freelancer',
    label: 'Freelancer / Solo',
    sub: 'Individual creative, leaner workflow.',
  },
  {
    value: 'inhouse',
    label: 'In-house / Brand Team',
    sub: 'Internal creative department.',
  },
];

const FOCUS_OPTIONS = [
  {
    value: 'video',
    label: 'Video Production',
    sub: 'Music videos, commercials, films, social video, events.',
  },
  {
    value: 'photography',
    label: 'Photography',
    sub: 'Events, portraits, commercial, real estate, fashion.',
  },
  {
    value: 'post',
    label: 'Post-Production',
    sub: 'Editing, color grading, VFX/motion, audio, photo retouching, subtitling.',
  },
  {
    value: 'design',
    label: 'Design & Branding',
    sub: 'Branding, graphic design, web design, social content.',
  },
  {
    value: 'animation',
    label: 'Animation',
    sub: '2D / 3D animation and motion.',
  },
];

const IDENTITY_LABELS = {
  agency: 'Agency / Studio',
  freelancer: 'Freelancer / Solo',
  inhouse: 'In-house / Brand Team',
};

const FOCUS_LABELS = {
  video: 'Video Production',
  photography: 'Photography',
  post: 'Post-Production',
  design: 'Design & Branding',
  animation: 'Animation',
};

export default function SetupWizard({ onComplete, onSkip, onDismissPermanently }) {
  const [step, setStep] = useState(1);
  const [identity, setIdentity] = useState('');
  const [focus, setFocus] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  function toggleFocus(val) {
    setFocus(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]);
  }

  function goNext() {
    if (step === 1 && !identity) { setErr('Select an option to continue'); return; }
    if (step === 2 && focus.length === 0) { setErr('Select at least one focus area'); return; }
    setErr('');
    setStep(s => s + 1);
  }

  async function finish() {
    setSaving(true);
    setErr('');
    try {
      await api.post('/settings/profile', { profile_completed: true, identity, focus });
      onComplete({ identity, focus });
    } catch (e) {
      setErr(e.message);
      setSaving(false);
    }
  }

  async function handleDismissPermanently() {
    try { await api.post('/settings/profile', { profile_completed: true }); } catch (_) {}
    onDismissPermanently();
  }

  return (
    <div className="setup-wizard-overlay">
      <div className="setup-wizard-box">
        {/* Header */}
        <div className="setup-wizard-header">
          <div>
            <div className="setup-wizard-title">Workspace Setup</div>
            <div className="setup-wizard-subtitle">Step {step} of 3 — personalizes your workflow</div>
          </div>
          <button className="modal-close" onClick={onSkip} title="Skip for now"><X size={18} /></button>
        </div>

        {/* Step indicators */}
        <div className="setup-wizard-steps">
          {[1, 2, 3].map(n => (
            <React.Fragment key={n}>
              <div className={`setup-wizard-step-dot${n < step ? ' done' : n === step ? ' active' : ''}`}>
                {n < step ? <Check size={11} /> : n}
              </div>
              {n < 3 && <div className={`setup-wizard-step-line${n < step ? ' done' : ''}`} />}
            </React.Fragment>
          ))}
        </div>

        {/* Content */}
        <div className="setup-wizard-content">
          {step === 1 && (
            <>
              <div className="setup-wizard-step-title">Who are you?</div>
              <div className="setup-wizard-cards">
                {IDENTITY_OPTIONS.map(opt => (
                  <div
                    key={opt.value}
                    className={`setup-wizard-card${identity === opt.value ? ' selected' : ''}`}
                    onClick={() => { setIdentity(opt.value); setErr(''); }}
                  >
                    {identity === opt.value && (
                      <div className="setup-wizard-card-check"><Check size={13} /></div>
                    )}
                    <div className="setup-wizard-card-label">{opt.label}</div>
                    <div className="setup-wizard-card-sub">{opt.sub}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="setup-wizard-step-title">What do you work on?</div>
              <div className="setup-wizard-cards">
                {FOCUS_OPTIONS.map(opt => (
                  <div
                    key={opt.value}
                    className={`setup-wizard-card${focus.includes(opt.value) ? ' selected' : ''}`}
                    onClick={() => { toggleFocus(opt.value); setErr(''); }}
                  >
                    {focus.includes(opt.value) && (
                      <div className="setup-wizard-card-check"><Check size={13} /></div>
                    )}
                    <div className="setup-wizard-card-label">{opt.label}</div>
                    <div className="setup-wizard-card-sub">{opt.sub}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="setup-wizard-step-title">Your Setup</div>
              <div className="setup-wizard-summary">
                <div className="setup-wizard-summary-row">
                  <span className="setup-wizard-summary-label">You are</span>
                  <span className="setup-wizard-summary-value">{IDENTITY_LABELS[identity]}</span>
                </div>
                <div className="setup-wizard-summary-row">
                  <span className="setup-wizard-summary-label">You work in</span>
                  <div className="setup-wizard-focus-tags">
                    {focus.map(f => (
                      <span key={f} className="setup-wizard-focus-tag">{FOCUS_LABELS[f]}</span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="setup-wizard-summary-note">
                This personalizes your category suggestions and project phase defaults. You can change this at any time from Settings.
              </div>
            </>
          )}
        </div>

        {err && <div className="error-msg" style={{ padding: '0 24px 8px' }}>{err}</div>}

        {/* Footer */}
        <div className="setup-wizard-footer">
          {step === 1 ? (
            <button className="btn btn-ghost btn-sm" style={{ fontSize: '12px' }} onClick={handleDismissPermanently}>
              Don't ask again
            </button>
          ) : (
            <button className="btn btn-ghost" onClick={() => { setErr(''); setStep(s => s - 1); }}>
              Back
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost btn-sm" style={{ marginRight: '8px', fontSize: '12px', color: '#666' }} onClick={onSkip}>
            Skip for now
          </button>
          {step < 3 ? (
            <button className="btn btn-primary" onClick={goNext}>
              Next <ArrowRight size={14} style={{ marginLeft: '2px' }} />
            </button>
          ) : (
            <button className="btn btn-primary" onClick={finish} disabled={saving}>
              {saving ? 'Saving...' : 'Finish'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
