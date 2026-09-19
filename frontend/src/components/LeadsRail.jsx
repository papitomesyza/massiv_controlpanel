import React, { useState } from 'react';
import {
  X, Plus, Lightbulb, Check, StickyNote, Edit2, Trash2,
  Video, Camera, Scissors, Palette, Film, Tag,
} from 'lucide-react';
import { api, fmt, fmtDate } from '../api';
import { Private } from '../context/PrivacyContext';
import AddLeadModal from './AddLeadModal';

// One leads rail, shared by the Dashboard and the Projects page. The chip is the
// whole object: avatar, name, category icon, value driven width and an age dot.
// Convert lives on the chip. Edit and dismiss live behind the chip's drawer, so
// the rail never grows a row of permanently visible buttons.

function categoryIcon(name) {
  const n = (name || '').toLowerCase();
  const size = 13;
  if (/photo|retouch|cull/.test(n)) return <Camera size={size} />;
  if (/video|film|commercial|documentary|event/.test(n)) return <Video size={size} />;
  if (/edit|color|colour|vfx|audio|podcast|subtit|mix|master/.test(n)) return <Scissors size={size} />;
  if (/brand|social|graphic|web|design/.test(n)) return <Palette size={size} />;
  if (/anim|2d|3d|motion/.test(n)) return <Film size={size} />;
  return <Tag size={size} />;
}

function ageDotClass(contactedAt) {
  if (!contactedAt) return 'age-cold';
  const d = new Date(String(contactedAt).includes('T') ? contactedAt : contactedAt + 'T00:00:00');
  if (isNaN(d.getTime())) return 'age-cold';
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 3) return 'age-fresh';
  if (days <= 7) return 'age-warm';
  return 'age-cold';
}

export default function LeadsRail({ leads, setLeads, onConvert }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [drawer, setDrawer]   = useState(null);

  const maxVal = leads.reduce((m, l) => Math.max(m, Number(l.value) || 0), 0);
  const MINW = 150, MAXW = 300;
  function chipWidth(v) {
    const val = Number(v) || 0;
    if (!val || maxVal <= 0) return MINW;
    return Math.round(MINW + (MAXW - MINW) * (val / maxVal));
  }

  async function handleDismiss(lead) {
    try { await api.put(`/leads/${lead.id}/dismiss`, {}); } catch (_) {}
    setLeads(prev => prev.filter(l => l.id !== lead.id));
    setDrawer(null);
  }

  return (
    <div className="leads-rail">
      {leads.map(lead => (
        <LeadChip
          key={lead.id}
          lead={lead}
          width={chipWidth(lead.value)}
          onOpen={() => setDrawer(lead)}
          onConvert={() => onConvert(lead)}
        />
      ))}

      {/* Ghost chip: the answer to an empty rail. */}
      <button className="lead-ghost" onClick={() => setShowAdd(true)} title="Add lead" aria-label="Add lead">
        <Plus size={18} />
      </button>

      {leads.length === 0 && (
        <div className="leads-rail-empty">
          <Lightbulb size={16} style={{ color: 'var(--color-hairline-strong)' }} />
          <span>No leads yet</span>
        </div>
      )}

      {showAdd && (
        <AddLeadModal
          onClose={() => setShowAdd(false)}
          onSaved={lead => { setLeads(prev => [lead, ...prev]); setShowAdd(false); }}
        />
      )}

      {editing && (
        <AddLeadModal
          lead={editing}
          onClose={() => setEditing(null)}
          onSaved={lead => { setLeads(prev => prev.map(l => l.id === lead.id ? lead : l)); setEditing(null); }}
        />
      )}

      {drawer && (
        <LeadDrawer
          lead={drawer}
          onClose={() => setDrawer(null)}
          onEdit={() => { setEditing(drawer); setDrawer(null); }}
          onDismiss={() => handleDismiss(drawer)}
        />
      )}
    </div>
  );
}

function LeadChip({ lead, width, onOpen, onConvert }) {
  const [confirming, setConfirming] = useState(false);
  const initial = (lead.client_name || '?').trim().charAt(0).toUpperCase() || '?';
  const catName = lead.category_name || 'Uncategorized';
  const tip = [catName, lead.contacted_at ? `Contacted ${fmtDate(lead.contacted_at)}` : null, lead.note || null]
    .filter(Boolean).join('\n');

  return (
    <div className="lead-chip" style={{ width }} title={tip}>
      <button className="lead-chip-main" onClick={onOpen}>
        <span className="lead-avatar">{initial}</span>
        <span className="lead-chip-body">
          <span className="lead-chip-name">{lead.client_name || 'No client'}</span>
          {Number(lead.value) > 0 && (
            <span className="lead-chip-value"><Private>{fmt(lead.value)}</Private></span>
          )}
        </span>
        <span className="lead-chip-cat" title={catName}>{categoryIcon(catName)}</span>
        <span className={`lead-age-dot ${ageDotClass(lead.contacted_at)}`} title={lead.contacted_at ? fmtDate(lead.contacted_at) : 'No date'} />
      </button>

      {confirming ? (
        <button className="lead-convert lead-convert-go" onClick={onConvert} title="Confirm convert" aria-label="Confirm convert">
          <Check size={14} />
        </button>
      ) : (
        <button className="lead-convert" onClick={() => setConfirming(true)} title="Convert to project" aria-label="Convert to project">
          <ArrowRightIcon />
        </button>
      )}
    </div>
  );
}

function ArrowRightIcon() {
  // A tiny inline chevron so the convert affordance reads without a word.
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function LeadDrawer({ lead, onClose, onEdit, onDismiss }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="lead-drawer-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="lead-drawer">
        <div className="lead-drawer-head">
          <span className="lead-drawer-title">{lead.client_name || 'Lead'}</span>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="lead-drawer-meta">
          <span className="lead-drawer-chip">{lead.category_name || 'Uncategorized'}</span>
          {lead.contacted_at && <span className="lead-drawer-chip">{fmtDate(lead.contacted_at)}</span>}
          {Number(lead.value) > 0 && <span className="lead-drawer-chip"><Private>{fmt(lead.value)}</Private></span>}
        </div>
        {lead.note ? (
          <div className="lead-drawer-note">
            <StickyNote size={14} style={{ color: 'var(--color-mid-gray)', marginBottom: 6 }} />
            <p>{lead.note}</p>
          </div>
        ) : (
          <div className="lead-drawer-note empty">No note</div>
        )}

        {/* Edit and dismiss live here, not on the rail. */}
        <div className="lead-drawer-actions">
          {confirming ? (
            <>
              <span className="lead-drawer-confirm-text">Dismiss this lead?</span>
              <button className="btn btn-danger btn-sm" onClick={onDismiss}>Yes, dismiss</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>Cancel</button>
            </>
          ) : (
            <>
              <button className="btn btn-ghost btn-sm" onClick={onEdit}>
                <Edit2 size={13} /> Edit
              </button>
              <button className="btn btn-ghost btn-sm lead-drawer-dismiss" onClick={() => setConfirming(true)}>
                <Trash2 size={13} /> Dismiss
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
