import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Plus, Check, Trash2, Edit2, ChevronDown, ChevronRight, FileDown, ArrowLeft, Lock, X, Copy, ArrowRight, Clock, GripVertical, Link2, Link2Off, ExternalLink, Image, Download, FileText, Library } from 'lucide-react';
import { api, fmt, fmtDate } from '../api';
import Modal from '../components/Modal';
import { PhaseTaskStep, InlineCrewModal, LocationPicker } from '../components/ProjectWizard';
import { getTasksForCategory } from '../data/projectTasks';

const PRODUCTION_GROUPS = ['Video Production', 'Photography'];

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [crewList, setCrewList] = useState([]);
  const [expCats, setExpCats] = useState([]);
  const [expandedPhases, setExpandedPhases] = useState({});
  const [pdfLoading, setPdfLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const [logInput, setLogInput] = useState('');
  const [logSaving, setLogSaving] = useState(false);

  const [taskModal, setTaskModal] = useState(null);
  const [paymentModal, setPaymentModal] = useState(null);
  const [crewModal, setCrewModal] = useState(null);
  const [expenseModal, setExpenseModal] = useState(null);
  const [revisionModal, setRevisionModal] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [duplicateModal, setDuplicateModal] = useState(false);
  const [phaseCompleteModal, setPhaseCompleteModal] = useState(null);
  const [showNewCrew, setShowNewCrew] = useState(false);
  const [expenseLink, setExpenseLink] = useState(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [revokeConfirm, setRevokeConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const [invoiceBlobUrls, setInvoiceBlobUrls] = useState({});
  const blobUrlsRef = useRef({});
  const [projectCollection, setProjectCollection] = useState(null);
  const [collLoading, setCollLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, cl, ec, lg, el] = await Promise.all([
        api.get(`/projects/${id}`),
        api.get('/crew'),
        api.get('/settings/expense-categories'),
        api.get(`/projects/${id}/logs`),
        api.get(`/projects/${id}/expense-link`),
      ]);
      setData(d);
      setCrewList(cl.filter(c => !c.archived));
      setExpCats(ec);
      setLogs(lg);
      setExpenseLink(el);
      const active = d.phases.find(p => p.status === 'active');
      if (active) setExpandedPhases(prev => ({ ...prev, [active.id]: true }));
    } catch { navigate('/projects'); }
    setLoading(false);
  }, [id, navigate]);

  const loadCollection = useCallback(async () => {
    try {
      const colls = await api.get('/collections');
      const found = (Array.isArray(colls) ? colls : []).find(c => String(c.project_id) === String(id));
      setProjectCollection(found || null);
    } catch (_) { setProjectCollection(null); }
  }, [id]);

  useEffect(() => { load(); loadCollection(); }, [load, loadCollection]);

  useEffect(() => {
    if (!data) return;
    Object.values(blobUrlsRef.current).forEach(u => URL.revokeObjectURL(u));
    blobUrlsRef.current = {};
    setInvoiceBlobUrls({});

    const filenames = [
      ...data.expenses.filter(e => e.invoice_image_path).map(e => e.invoice_image_path),
      ...(data.pendingExpenses || []).filter(e => e.invoice_image_path).map(e => e.invoice_image_path),
    ];
    const unique = [...new Set(filenames)];
    if (unique.length === 0) return;

    let active = true;
    Promise.all(unique.map(async fn => [fn, await api.getBlobUrl(`/uploads/${fn}`)])).then(pairs => {
      if (!active) { pairs.forEach(([, u]) => u && URL.revokeObjectURL(u)); return; }
      const map = {};
      pairs.forEach(([fn, u]) => { if (u) map[fn] = u; });
      blobUrlsRef.current = map;
      setInvoiceBlobUrls(map);
    });
    return () => { active = false; };
  }, [data]);

  if (loading) return <div className="loading">Loading project...</div>;
  if (!data) return null;

  const { project, phases, revisionRounds, crewAssignments, clientPayments, expenses, pendingExpenses, pnl, statusHistory, duplicatedFromTitle } = data;

  async function handleCompletePhase(phase) {
    const nextPhase = phases.find(p => p.order_index === phase.order_index + 1);
    if (nextPhase) {
      setPhaseCompleteModal({ phase, nextPhase });
    } else {
      await api.put(`/projects/${id}/phases/${phase.id}/complete`, {});
      load();
    }
  }

  async function reactivatePhase(phaseId) {
    await api.put(`/projects/${id}/phases/${phaseId}/reactivate`, {});
    load();
  }

  async function handleDelete() {
    await api.del(`/projects/${id}`);
    navigate('/projects');
  }

  async function handlePdf() {
    setPdfLoading(true);
    try { await api.download(`/projects/${id}/pdf`, `MASSIV-${project.title}.pdf`); }
    catch (e) { alert(e.message); }
    setPdfLoading(false);
  }

  async function addNewCrew(form) {
    const newCrew = await api.post('/crew', form);
    const updated = await api.get('/crew');
    setCrewList(updated.filter(c => !c.archived));
    setShowNewCrew(false);
    return newCrew.id;
  }

  async function addLog() {
    if (!logInput.trim()) return;
    setLogSaving(true);
    try {
      await api.post(`/projects/${id}/logs`, { note: logInput.trim() });
      setLogInput('');
      const updated = await api.get(`/projects/${id}/logs`);
      setLogs(updated);
    } catch (e) { alert(e.message); }
    setLogSaving(false);
  }

  async function deleteLog(logId) {
    await api.del(`/projects/${id}/logs/${logId}`);
    const updated = await api.get(`/projects/${id}/logs`);
    setLogs(updated);
  }

  async function generateLink() {
    setLinkLoading(true);
    try {
      const res = await api.post(`/projects/${id}/expense-link`, {});
      setExpenseLink({ exists: true, is_active: true, token: res.token, url: res.url });
    } catch (e) { alert(e.message); }
    setLinkLoading(false);
  }

  async function revokeLink() {
    setRevokeConfirm(false);
    setLinkLoading(true);
    try {
      await api.del(`/projects/${id}/expense-link`);
      setExpenseLink(prev => ({ ...prev, is_active: false }));
    } catch (e) { alert(e.message); }
    setLinkLoading(false);
  }

  function copyLink() {
    const url = `${window.location.origin}${expenseLink.url}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function openOrCreateReferences() {
    if (projectCollection) {
      navigate(`/collections/${projectCollection.id}`);
      return;
    }
    setCollLoading(true);
    try {
      const res = await api.post('/collections', {
        name: project.title,
        project_id: Number(id),
      });
      await loadCollection();
      navigate(`/collections/${res.id}`);
    } catch (err) {
      alert(err.message || 'Failed to create references collection');
    } finally {
      setCollLoading(false);
    }
  }

  const postProdPhase = phases.find(p => p.phase_name === 'Post-Production');

  return (
    <div>
      {/* Header */}
      <div className="flex-between mb-4" style={{ flexWrap: 'wrap', gap: '12px' }}>
        <div className="flex-center gap-2">
          <Link to="/projects" className="btn btn-ghost btn-sm"><ArrowLeft size={14} /></Link>
          <div>
            <div className="page-title">{project.title}</div>
            <div className="text-2 text-sm">{project.client_name || 'No client'}{project.category_name ? ` · ${project.category_name}` : ''}</div>
            {duplicatedFromTitle && (
              <div className="duplicated-from">
                <Copy size={10} /> Duplicated from{' '}
                <Link to={`/projects/${project.duplicated_from}`} className="link" style={{ color: 'inherit' }}>{duplicatedFromTitle}</Link>
              </div>
            )}
          </div>
        </div>
        <div className="flex-center gap-2" style={{ flexWrap: 'wrap' }}>
          <StatusBadge status={project.status} />
          <button className="btn btn-ghost btn-sm" onClick={() => setEditModal(true)}><Edit2 size={14} /> Edit</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setDuplicateModal(true)}><Copy size={14} /> Duplicate</button>
          <button className="btn btn-danger btn-sm" onClick={() => setDeleteModal(true)}><Trash2 size={14} /> Delete</button>
          <button className="btn btn-ghost btn-sm" onClick={handlePdf} disabled={pdfLoading}>
            <FileDown size={14} /> {pdfLoading ? 'Exporting...' : 'Export PDF'}
          </button>
        </div>
      </div>

      <div className="two-col">
        {/* LEFT */}
        <div>
          <div className="card card-pad mb-3" style={{ marginBottom: '16px' }}>
            <div className="section-title mb-3" style={{ marginBottom: '12px' }}>
              <Clock size={13} style={{ display: 'inline', marginRight: '6px', verticalAlign: 'middle' }} />
              Project Timeline
            </div>
            {phases.map(phase => (
              <PhaseBlock
                key={phase.id}
                phase={phase}
                expanded={!!expandedPhases[phase.id]}
                onToggle={() => setExpandedPhases(p => ({ ...p, [phase.id]: !p[phase.id] }))}
                onComplete={() => handleCompletePhase(phase)}
                onReactivate={() => reactivatePhase(phase.id)}
                onAddTask={() => setTaskModal({ phaseId: phase.id })}
                onEditTask={task => setTaskModal({ task })}
                onDeleteTask={async t => { await api.del(`/projects/${id}/tasks/${t.id}`); load(); }}
                onTaskStatus={async (task, status) => {
                  await api.put(`/projects/${id}/tasks/${task.id}`, { ...task, status });
                  load();
                }}
                onReorderTasks={async (taskIds) => {
                  await api.patch('/tasks/reorder', { taskIds });
                  load();
                }}
                crewList={crewList}
              />
            ))}

            {/* Status History */}
            {statusHistory && statusHistory.length > 0 && (
              <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
                <div className="section-title" style={{ marginBottom: '8px' }}>Status History</div>
                {statusHistory.map(h => (
                  <div key={h.id} className="status-history-item">
                    <ArrowRight size={12} style={{ color: '#737373', flexShrink: 0 }} />
                    <span className="text-2">{h.from_status?.replace(/-/g, ' ') || 'created'}</span>
                    <ArrowRight size={10} style={{ color: '#737373' }} />
                    <span>{h.to_status.replace(/-/g, ' ')}</span>
                    <span className="text-xs text-2" style={{ marginLeft: 'auto' }}>
                      {fmtDate(h.changed_at)}
                      {' '}
                      {new Date(h.changed_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Revision Rounds */}
          {postProdPhase && (
            <div className="card card-pad" style={{ marginBottom: '16px' }}>
              <div className="section-header">
                <span className="section-title">Revision Rounds</span>
                <button className="btn btn-ghost btn-sm" onClick={() => setRevisionModal(true)}><Plus size={13} /></button>
              </div>
              {revisionRounds.length === 0 ? (
                <div className="empty" style={{ padding: '12px 0', textAlign: 'left' }}>No revisions yet</div>
              ) : (
                revisionRounds.map(r => (
                  <div key={r.id} className="list-item">
                    <div>
                      <span className="text-bold text-sm">Round {r.round_number}</span>
                      <span className="text-2 text-sm" style={{ marginLeft: '10px' }}>{fmtDate(r.date)}</span>
                      {r.notes && <div className="text-2 text-xs mt-1">{r.notes}</div>}
                    </div>
                    <button className="btn btn-danger btn-sm" onClick={async () => { await api.del(`/projects/${id}/revisions/${r.id}`); load(); }}><Trash2 size={13} /></button>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Project Log */}
          <div className="card card-pad" style={{ marginBottom: '16px' }}>
            <div className="section-title" style={{ marginBottom: '12px' }}>Project Log</div>
            <div className="flex-center gap-2" style={{ marginBottom: '12px' }}>
              <input
                className="input"
                placeholder="Add a note..."
                value={logInput}
                onChange={e => setLogInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !logSaving && addLog()}
                style={{ flex: 1 }}
              />
              <button className="btn btn-ghost btn-sm" onClick={addLog} disabled={logSaving || !logInput.trim()}>
                {logSaving ? '...' : 'Add Note'}
              </button>
            </div>
            {logs.length === 0 ? (
              <div className="empty" style={{ padding: '8px 0', textAlign: 'left' }}>No log entries yet</div>
            ) : (
              logs.map(log => (
                <div key={log.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div className="text-xs text-2" style={{ marginBottom: '2px' }}>
                      {fmtDate(log.created_at)}
                      {' · '}
                      {new Date(log.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div className="text-sm">{log.note}</div>
                  </div>
                  <button className="btn btn-danger btn-sm" style={{ marginTop: '2px' }} onClick={() => deleteLog(log.id)}><Trash2 size={12} /></button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* RIGHT */}
        <div>
          <div className="card card-pad" style={{ marginBottom: '16px' }}>
            <div className="section-title" style={{ marginBottom: '12px' }}>Agreed Budget</div>
            <div style={{ fontSize: '28px', fontWeight: 800 }}>{fmt(project.agreed_budget)}</div>
            {PRODUCTION_GROUPS.includes(project.category_group) ? (
              project.shoot_date && (
                <div className="text-2 text-sm mt-1">
                  {'Shoot: '}
                  {fmtDate(project.shoot_date)}
                  {project.shoot_start_time ? `, ${project.shoot_start_time.slice(0, 5)}${project.shoot_end_time ? `–${project.shoot_end_time.slice(0, 5)}` : ''}` : ''}
                  {` · ${project.shoot_days}d`}
                  {project.shoot_location ? ` · ${project.shoot_location}` : ''}
                </div>
              )
            ) : (
              project.deadline && (
                <div className="text-2 text-sm mt-1">{'Deadline: '}{fmtDate(project.deadline)}</div>
              )
            )}
            {PRODUCTION_GROUPS.includes(project.category_group) && project.deadline && (
              <div className="text-2 text-sm mt-1">{'Deadline: '}{fmtDate(project.deadline)}</div>
            )}
          </div>

          <div className="card card-pad" style={{ marginBottom: '16px' }}>
            <div className="section-header">
              <span className="section-title">Client Payments</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setPaymentModal({})}><Plus size={13} /></button>
            </div>
            {clientPayments.map(p => (
              <div key={p.id} className="fin-row">
                <div>
                  <span className={p.status === 'received' ? 'text-bold' : 'text-2'}>{fmt(p.amount)}</span>
                  <span className="text-xs text-2" style={{ marginLeft: '8px' }}>{fmtDate(p.date)}</span>
                  {p.notes && <div className="text-xs text-2">{p.notes}</div>}
                </div>
                <div className="flex-center gap-2">
                  <span className={`badge ${p.status === 'received' ? 'badge-paid' : 'badge-unpaid'}`}>{p.status}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => setPaymentModal(p)}><Edit2 size={12} /></button>
                  <button className="btn btn-danger btn-sm" onClick={async () => { await api.del(`/projects/${id}/payments/${p.id}`); load(); }}><Trash2 size={12} /></button>
                </div>
              </div>
            ))}
            <div className="fin-row total" style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--border)' }}>
              <span>Total Received</span><span>{fmt(pnl.totalReceived)}</span>
            </div>
          </div>

          <div className="card card-pad" style={{ marginBottom: '16px' }}>
            <div className="section-header">
              <span className="section-title">Crew Costs</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setCrewModal({})}><Plus size={13} /></button>
            </div>
            {crewAssignments.map(c => (
              <div key={c.id} className="fin-row">
                <div>
                  <span className="text-bold text-sm">{c.crew_name}</span>
                  <span className="text-xs text-2" style={{ marginLeft: '6px' }}>{c.role_on_project || c.crew_role}</span>
                  <div className="text-xs text-2">{c.days}d × {fmt(c.rate_per_day)} = {fmt(c.days * c.rate_per_day)}</div>
                </div>
                <div className="flex-center gap-2">
                  <span className={`badge ${c.paid_status === 'paid' ? 'badge-paid' : c.paid_status === 'partial' ? 'badge-partial' : 'badge-unpaid'}`}>{c.paid_status}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => setCrewModal(c)}><Edit2 size={12} /></button>
                  <button className="btn btn-danger btn-sm" onClick={async () => { await api.del(`/projects/${id}/crew/${c.id}`); load(); }}><Trash2 size={12} /></button>
                </div>
              </div>
            ))}
            <div className="fin-row total" style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--border)' }}>
              <span>Total Crew Cost</span><span>{fmt(pnl.totalCrewCost)}</span>
            </div>
          </div>

          <div className="card card-pad" style={{ marginBottom: '16px' }}>
            <div className="section-header">
              <span className="section-title">Expenses</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setExpenseModal({})}><Plus size={13} /></button>
            </div>

            {/* Expense Link subsection */}
            <div style={{ marginBottom: '14px', paddingBottom: '14px', borderBottom: '1px solid var(--border)' }}>
              {project.status === 'completed' ? (
                <div className="text-xs text-2">Project completed — expense link disabled</div>
              ) : expenseLink === null ? (
                <div className="text-xs text-2">Loading...</div>
              ) : !expenseLink.exists ? (
                <div className="flex-center gap-2">
                  <span className="text-xs text-2">No expense link generated</span>
                  <button className="btn btn-ghost btn-sm" onClick={generateLink} disabled={linkLoading}><Link2 size={12} /> Generate Link</button>
                </div>
              ) : !expenseLink.is_active ? (
                <div className="flex-center gap-2">
                  <span className="badge" style={{ background: '#f5f5f5', color: '#737373', fontSize: '11px' }}>Link revoked</span>
                  <button className="btn btn-ghost btn-sm" onClick={generateLink} disabled={linkLoading}><Link2 size={12} /> Generate New Link</button>
                </div>
              ) : (
                <div>
                  <div className="flex-center gap-2" style={{ flexWrap: 'wrap' }}>
                    <span className="text-xs text-2" style={{ fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '160px', whiteSpace: 'nowrap' }}>
                      {`${window.location.origin}${expenseLink.url}`}
                    </span>
                    <button className="btn btn-ghost btn-sm" onClick={copyLink} style={{ minWidth: '60px' }}>
                      <Copy size={11} /> {copied ? 'Copied!' : 'Copy'}
                    </button>
                    <a href={expenseLink.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
                      <ExternalLink size={11} /> Open
                    </a>
                    {!revokeConfirm ? (
                      <button className="btn btn-danger btn-sm" onClick={() => setRevokeConfirm(true)} disabled={linkLoading}>
                        <Link2Off size={11} /> Revoke
                      </button>
                    ) : (
                      <div className="flex-center gap-1">
                        <span className="text-xs text-2">Confirm?</span>
                        <button className="btn btn-danger btn-sm" onClick={revokeLink}>Yes</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setRevokeConfirm(false)}>No</button>
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-2" style={{ marginTop: '6px' }}>Share with your production manager to allow expense submissions</div>
                </div>
              )}
            </div>

            {(pendingExpenses || []).length > 0 && (
              <div style={{ marginBottom: '14px', paddingBottom: '4px', borderBottom: '1px solid var(--border)' }}>
                <div className="text-sm" style={{ color: 'var(--warning)', fontWeight: 700, marginBottom: '8px' }}>
                  Pending review ({pendingExpenses.length})
                </div>
                {pendingExpenses.map(pe => (
                  <div key={pe.id} className="fin-row" style={{ alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div>
                        <span className="text-sm">{pe.category_text || 'Uncategorized'}</span>
                        <span className="text-xs text-2" style={{ marginLeft: '8px' }}>{fmtDate(pe.date)}</span>
                      </div>
                      {pe.notes && <div className="text-xs text-2">{pe.notes}</div>}
                      {pe.submitted_by && <div className="text-xs text-2">by {pe.submitted_by}</div>}
                    </div>
                    <div className="flex-center gap-2" style={{ flexShrink: 0 }}>
                      <span className="text-bold text-sm">{fmt(pe.amount)}</span>
                      <button className="btn btn-ghost btn-sm" style={{ color: '#0a0a0a', fontSize: '11px' }}
                        onClick={async () => { await api.post(`/projects/${id}/expenses/${pe.id}/approve`, {}); load(); }}>
                        Approve
                      </button>
                      <button className="btn btn-danger btn-sm" style={{ fontSize: '11px' }}
                        onClick={async () => { await api.del(`/projects/${id}/expenses/${pe.id}`); load(); }}>
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {expenses.map(e => (
              <div key={e.id} className="fin-row" style={{ alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
                  {e.invoice_image_path && (
                    <div
                      onClick={() => {
                        const isPdf = e.invoice_image_path.toLowerCase().endsWith('.pdf');
                        const blobUrl = invoiceBlobUrls[e.invoice_image_path];
                        if (isPdf) { if (blobUrl) window.open(blobUrl, '_blank'); }
                        else setLightboxSrc({ src: blobUrl || '', filename: e.invoice_image_path });
                      }}
                      style={{ flexShrink: 0, cursor: 'pointer' }}
                      title="View invoice"
                    >
                      {e.invoice_image_path.toLowerCase().endsWith('.pdf') ? (
                        <div style={{ width: '32px', height: '32px', background: '#ffffff', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <FileText size={16} color="#737373" />
                        </div>
                      ) : (
                        <img
                          src={invoiceBlobUrls[e.invoice_image_path] || ''}
                          alt="invoice"
                          style={{ width: '32px', height: '32px', borderRadius: '6px', objectFit: 'cover' }}
                        />
                      )}
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div>
                      <span className="text-sm">{e.category_name || 'Uncategorized'}</span>
                      <span className="text-xs text-2" style={{ marginLeft: '8px' }}>{fmtDate(e.date)}</span>
                    </div>
                    {e.notes && <div className="text-xs text-2">{e.notes}</div>}
                    {e.submitted_by && (
                      <div className="text-xs text-2" style={{ marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ background: '#ffffff', borderRadius: '6px', padding: '1px 6px', fontSize: '10px' }}>via link</span>
                        <span>{e.submitted_by}</span>
                      </div>
                    )}
                    {!e.submitted_by && e.source === 'link' && (
                      <div className="text-xs text-2" style={{ marginTop: '2px' }}>
                        <span style={{ background: '#ffffff', borderRadius: '6px', padding: '1px 6px', fontSize: '10px' }}>via link</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex-center gap-2" style={{ flexShrink: 0, marginTop: '2px' }}>
                  <span className="text-bold text-sm">{fmt(e.amount)}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => setExpenseModal(e)}><Edit2 size={12} /></button>
                  <button className="btn btn-danger btn-sm" onClick={async () => { await api.del(`/projects/${id}/expenses/${e.id}`); load(); }}><Trash2 size={12} /></button>
                </div>
              </div>
            ))}
            <div className="fin-row total" style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--border)' }}>
              <span>Total Expenses</span><span>{fmt(pnl.totalExpenses)}</span>
            </div>
          </div>

          <div className="card card-pad" style={{ marginBottom: '16px' }}>
            <div className="section-header">
              <span className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Library size={13} color="var(--accent)" /> References
              </span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={openOrCreateReferences}
                disabled={collLoading}
                style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
              >
                {collLoading
                  ? '…'
                  : projectCollection
                    ? <><ExternalLink size={12} /> Open</>
                    : <><Plus size={12} /> Create</>
                }
              </button>
            </div>
            {projectCollection ? (
              <div
                className="list-item"
                style={{ cursor: 'pointer' }}
                onClick={openOrCreateReferences}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Library size={14} color="var(--accent)" />
                  <span className="text-sm">{projectCollection.name}</span>
                </div>
                <span className="text-xs text-2">{projectCollection.card_count} {projectCollection.card_count === 1 ? 'card' : 'cards'}</span>
              </div>
            ) : (
              <div className="empty" style={{ padding: '10px 0', textAlign: 'left', fontSize: '12px' }}>
                No references collection yet. Click Create to start one.
              </div>
            )}
          </div>

          <div className="card card-pad">
            <div className="section-title" style={{ marginBottom: '12px' }}>P&L Summary</div>
            {[
              { label: 'Agreed Budget', val: fmt(pnl.agreedBudget) },
              { label: 'Total Received', val: fmt(pnl.totalReceived) },
              { label: 'Total Crew Cost', val: fmt(pnl.totalCrewCost) },
              { label: 'Total Expenses', val: fmt(pnl.totalExpenses) },
            ].map(({ label, val }) => (
              <div key={label} className="fin-row"><span className="text-2">{label}</span><span>{val}</span></div>
            ))}
            {pnl.clientBudget > 0 && (
              <div className="fin-row">
                <span className="text-2">Negotiation Delta</span>
                <span style={{ color: (pnl.agreedBudget - pnl.clientBudget) >= 0 ? '#0a0a0a' : '#e7000b', fontWeight: 600 }}>
                  {(pnl.agreedBudget - pnl.clientBudget) >= 0 ? '+' : ''}{fmt(pnl.agreedBudget - pnl.clientBudget)}
                </span>
              </div>
            )}
            <div style={{ borderTop: '1px solid var(--border)', marginTop: '8px', paddingTop: '8px' }}>
              <div className="fin-row"><span>Expected Profit</span><span className={pnl.expectedProfit < 0 ? 'text-danger text-bold' : 'text-bold'}>{fmt(pnl.expectedProfit)}</span></div>
              <div className="fin-row"><span>Realized Profit</span><span className={pnl.realizedProfit < 0 ? 'text-danger text-bold' : 'text-bold'}>{fmt(pnl.realizedProfit)}</span></div>
              <div className="fin-row">
                <span>Profit Margin</span>
                <span className={pnl.profitMargin !== null && pnl.profitMargin < 0 ? 'text-danger text-bold' : 'text-bold'}>
                  {pnl.profitMargin === null ? '—' : `${pnl.profitMargin}%`}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {taskModal && (
        <TaskModal modal={taskModal} projectId={id} phases={phases} crewList={crewList} onClose={() => setTaskModal(null)} onSaved={load} />
      )}
      {paymentModal !== null && (
        <PaymentModal payment={paymentModal} projectId={id} onClose={() => setPaymentModal(null)} onSaved={load} />
      )}
      {crewModal !== null && (
        <CrewAssignModal assign={crewModal} projectId={id} crewList={crewList} onClose={() => setCrewModal(null)} onSaved={load} onAddCrew={() => setShowNewCrew(true)} />
      )}
      {expenseModal !== null && (
        <ExpenseModal expense={expenseModal} projectId={id} expCats={expCats} invoiceBlobUrls={invoiceBlobUrls} onClose={() => setExpenseModal(null)} onSaved={load} />
      )}
      {revisionModal && (
        <RevisionModal projectId={id} onClose={() => setRevisionModal(false)} onSaved={load} />
      )}
      {editModal && (
        <EditProjectModal project={project} projectId={id} onClose={() => setEditModal(false)} onSaved={load} />
      )}
      {phaseCompleteModal && (
        <PhaseCompleteModal
          projectId={id}
          project={project}
          currentPhase={phaseCompleteModal.phase}
          nextPhase={phaseCompleteModal.nextPhase}
          crewList={crewList}
          onClose={() => setPhaseCompleteModal(null)}
          onDone={() => { setPhaseCompleteModal(null); load(); }}
        />
      )}
      {showNewCrew && (
        <InlineCrewModal onClose={() => setShowNewCrew(false)} onSave={addNewCrew} />
      )}
      {deleteModal && (
        <DeleteProjectModal projectTitle={project.title} onClose={() => setDeleteModal(false)} onConfirm={handleDelete} />
      )}
      {duplicateModal && (
        <DuplicateModal project={project} onClose={() => setDuplicateModal(false)} onDone={newId => navigate(`/projects/${newId}`)} />
      )}
      {lightboxSrc && (
        <ImageLightbox src={lightboxSrc.src} filename={lightboxSrc.filename} onClose={() => setLightboxSrc(null)} />
      )}
    </div>
  );
}

/* ---- PhaseBlock ---- */
function PhaseBlock({ phase, expanded, onToggle, onComplete, onReactivate, onAddTask, onEditTask, onDeleteTask, onTaskStatus, crewList, onReorderTasks }) {
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);

  const lockedPending = phase.tasks.filter(t => t.is_locked && t.status !== 'done');
  const allDone = phase.tasks.length > 0 && phase.tasks.every(t => t.status === 'done');
  const statusClass = phase.status === 'active' ? 'active' : phase.status === 'completed' ? 'completed' : 'pending';

  return (
    <div className="phase-item">
      <div className={`phase-header ${statusClass}`} onClick={onToggle}>
        <div className="flex-center gap-2">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="phase-name">{phase.phase_name}</span>
          <span className="text-xs text-2">({phase.tasks.length} tasks)</span>
        </div>
        <div className="flex-center gap-2">
          <PhaseStatusBadge status={phase.status} />
          {phase.status === 'active' && allDone && (
            <button className="btn btn-primary btn-sm" onClick={e => { e.stopPropagation(); onComplete(); }}>
              <Check size={12} /> Complete
            </button>
          )}
          {phase.status === 'active' && !allDone && lockedPending.length > 0 && phase.tasks.length > 0 && (
            <span className="text-xs text-2" style={{ fontSize: '10px' }}>Approve to advance</span>
          )}
          {phase.status === 'completed' && (
            <button className="btn btn-ghost btn-sm" style={{ fontSize: '11px' }} onClick={e => { e.stopPropagation(); onReactivate(); }}>
              Reactivate
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="phase-body">
          {phase.tasks.map(task => (
            <div
              key={task.id}
              className={`task-item ${task.is_locked ? 'task-locked' : ''}`}
              draggable={!task.is_locked}
              onMouseEnter={() => setHoveredId(task.id)}
              onMouseLeave={() => setHoveredId(null)}
              onDragStart={e => {
                if (task.is_locked) return;
                setDragId(task.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => { setDragId(null); setDragOverId(null); }}
              onDragOver={e => {
                e.preventDefault();
                if (!task.is_locked && task.id !== dragId) setDragOverId(task.id);
              }}
              onDragLeave={() => setDragOverId(null)}
              onDrop={e => {
                e.preventDefault();
                if (dragId && dragId !== task.id) {
                  const ids = phase.tasks.map(t => t.id);
                  const from = ids.indexOf(dragId);
                  const to = ids.indexOf(task.id);
                  if (from !== -1 && to !== -1) {
                    ids.splice(from, 1);
                    ids.splice(to, 0, dragId);
                    onReorderTasks(ids);
                  }
                }
                setDragId(null); setDragOverId(null);
              }}
              style={{
                opacity: dragId === task.id ? 0.5 : 1,
                borderTop: dragOverId === task.id && dragId !== task.id ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              {task.is_locked ? (
                <div className="task-lock-icon" title="Locked approval task"><Lock size={12} /></div>
              ) : (
                <div style={{ cursor: 'grab', color: '#737373', paddingRight: '4px', display: 'flex', alignItems: 'center', opacity: hoveredId === task.id ? 1 : 0, transition: 'opacity 0.15s', flexShrink: 0 }}>
                  <GripVertical size={14} />
                </div>
              )}
              <div
                className={`task-checkbox ${task.status === 'done' ? 'done' : ''}`}
                onClick={() => onTaskStatus(task, task.status === 'done' ? 'todo' : 'done')}
                title="Click to toggle done"
              >
                {task.status === 'done' && <Check size={10} color="#0a0a0a" />}
              </div>
              <div style={{ flex: 1 }}>
                <span className={task.status === 'done' ? 'text-2' : ''} style={{ textDecoration: task.status === 'done' ? 'line-through' : 'none', fontSize: '13px' }}>{task.title}</span>
                {(task.crew_name || task.due_date) && (
                  <div className="text-xs text-2">
                    {task.crew_name && <span>{task.crew_name}</span>}
                    {task.crew_name && task.due_date && <span> · </span>}
                    {task.due_date && <span>Due {fmtDate(task.due_date)}</span>}
                  </div>
                )}
              </div>
              <div className="flex-center gap-1">
                <button className="btn btn-ghost btn-sm" onClick={() => onEditTask(task)} style={{ padding: '4px 6px' }}><Edit2 size={12} /></button>
                {!task.is_locked && (
                  <button className="btn btn-danger btn-sm" onClick={() => onDeleteTask(task)} style={{ padding: '4px 6px' }}><Trash2 size={12} /></button>
                )}
              </div>
            </div>
          ))}
          <button className="btn btn-ghost btn-sm" style={{ marginTop: '8px' }} onClick={onAddTask}><Plus size={13} /> Add Task</button>
        </div>
      )}
    </div>
  );
}

/* ---- Phase Complete Modal ---- */
function PhaseCompleteModal({ projectId, project, currentPhase, nextPhase, crewList, onClose, onDone }) {
  const [tasks, setTasks] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (project.category_name) {
      const tasksByPhase = getTasksForCategory(project.category_name, project.shoot_days || 1);
      const options = tasksByPhase[nextPhase.phase_name] || [];
      setTasks(options.map(t => ({ title: t, included: false, crew_id: '' })));
    }
  }, [project.category_name, nextPhase.phase_name, project.shoot_days]);

  async function confirm() {
    setSaving(true);
    try {
      const selected = tasks.filter(t => t.included);
      if (selected.length > 0) {
        await api.post(`/projects/${projectId}/tasks/batch`, {
          tasks: selected.map(t => ({ phase_id: nextPhase.id, title: t.title, assigned_crew_id: t.crew_id || null })),
        });
      }
      await api.put(`/projects/${projectId}/phases/${currentPhase.id}/complete`, {});
      onDone();
    } catch (e) { alert(e.message); }
    setSaving(false);
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: '680px' }}>
        <div className="modal-header">
          <span className="modal-title">Starting {nextPhase.phase_name}</span>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <p className="text-2 text-sm" style={{ marginBottom: '16px' }}>
          Optionally add tasks to <strong style={{ color: '#0a0a0a' }}>{nextPhase.phase_name}</strong> before marking <strong style={{ color: '#0a0a0a' }}>{currentPhase.phase_name}</strong> complete.
        </p>
        <PhaseTaskStep
          phaseName={nextPhase.phase_name}
          tasks={tasks}
          onToggle={(idx) => setTasks(prev => prev.map((t, i) => i === idx ? { ...t, included: !t.included } : t))}
          onCrewChange={(idx, cid) => setTasks(prev => prev.map((t, i) => i === idx ? { ...t, crew_id: cid } : t))}
          onAddCustom={(title) => setTasks(prev => [...prev, { title, included: true, crew_id: '', isCustom: true }])}
          onRemoveCustom={(idx) => setTasks(prev => prev.filter((_, i) => i !== idx))}
          crewList={crewList}
        />
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={confirm} disabled={saving}>
            {saving ? 'Saving...' : `Complete ${currentPhase.phase_name} →`}
          </button>
        </div>
      </div>
    </div>
  );
}

function PhaseStatusBadge({ status }) {
  const map = { active: 'badge-active', completed: 'badge-completed', pending: 'badge-pending' };
  return <span className={`badge ${map[status] || 'badge-pending'}`}>{status}</span>;
}

function StatusBadge({ status }) {
  const map = {
    'development':     'badge-development',
    'pre-production':  'badge-pre-production',
    'production':      'badge-production',
    'post-production': 'badge-post-production',
    'completed':       'badge-completed',
  };
  return <span className={`badge ${map[status] || 'badge-pending'}`}>{status?.replace(/-/g, ' ')}</span>;
}

/* ---- Task Modal ---- */
function TaskModal({ modal, projectId, phases, crewList, onClose, onSaved }) {
  const isEdit = !!modal.task;
  const [form, setForm] = useState({
    title: modal.task?.title || '',
    phase_id: modal.task?.phase_id || modal.phaseId || '',
    assigned_crew_id: modal.task?.assigned_crew_id || '',
    due_date: modal.task?.due_date || '',
    notes: modal.task?.notes || '',
    status: modal.task?.status || 'todo',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  function f(k, v) { setForm(p => ({ ...p, [k]: v })); }

  async function save() {
    if (!form.title) return setErr('Title required');
    setSaving(true);
    try {
      if (isEdit) await api.put(`/projects/${projectId}/tasks/${modal.task.id}`, form);
      else await api.post(`/projects/${projectId}/tasks`, { ...form, phase_id: form.phase_id });
      onSaved(); onClose();
    } catch (e) { setErr(e.message); }
    setSaving(false);
  }

  return (
    <Modal title={isEdit ? 'Edit Task' : 'Add Task'} onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
    </>}>
      <div className="form-row">
        <label className="form-label">Title *</label>
        <input className="input" value={form.title} onChange={e => f('title', e.target.value)} placeholder="Task title" />
      </div>
      {!modal.phaseId && (
        <div className="form-row">
          <label className="form-label">Phase</label>
          <select className="select" value={form.phase_id} onChange={e => f('phase_id', e.target.value)}>
            <option value="">Select phase</option>
            {phases.map(p => <option key={p.id} value={p.id}>{p.phase_name}</option>)}
          </select>
        </div>
      )}
      <div className="form-grid">
        <div className="form-row">
          <label className="form-label">Assign Crew</label>
          <select className="select" value={form.assigned_crew_id} onChange={e => f('assigned_crew_id', e.target.value)}>
            <option value="">Unassigned</option>
            {crewList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="form-row">
          <label className="form-label">Due Date</label>
          <input type="date" className="input" value={form.due_date} onChange={e => f('due_date', e.target.value)} />
        </div>
      </div>
      {isEdit && (
        <div className="form-row">
          <label className="form-label">Status</label>
          <select className="select" value={form.status} onChange={e => f('status', e.target.value)}>
            <option value="todo">To Do</option>
            <option value="in-progress">In Progress</option>
            <option value="done">Done</option>
          </select>
        </div>
      )}
      <div className="form-row">
        <label className="form-label">Notes</label>
        <textarea className="input" value={form.notes} onChange={e => f('notes', e.target.value)} placeholder="Notes..." />
      </div>
      {err && <div className="error-msg">{err}</div>}
    </Modal>
  );
}

/* ---- Payment Modal ---- */
function PaymentModal({ payment, projectId, onClose, onSaved }) {
  const isEdit = !!payment?.id;
  const [form, setForm] = useState({
    amount: payment?.amount || '',
    date: payment?.date || new Date().toISOString().slice(0, 10),
    method: payment?.method || 'bank_transfer',
    notes: payment?.notes || '',
    status: payment?.status || 'pending',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  function f(k, v) {
    setForm(p => {
      const next = { ...p, [k]: v };
      if (k === 'status' && v === 'received') {
        next.date = new Date().toISOString().split('T')[0];
      }
      return next;
    });
  }

  async function save() {
    if (!form.amount || !form.date) return setErr('Amount and date required');
    setSaving(true);
    try {
      if (isEdit) await api.put(`/projects/${projectId}/payments/${payment.id}`, form);
      else await api.post(`/projects/${projectId}/payments`, form);
      onSaved(); onClose();
    } catch (e) { setErr(e.message); }
    setSaving(false);
  }

  return (
    <Modal title={isEdit ? 'Edit Payment' : 'Add Payment'} onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
    </>}>
      <div className="form-grid">
        <div className="form-row">
          <label className="form-label">Amount (€) *</label>
          <input type="number" className="input" value={form.amount} onChange={e => f('amount', e.target.value)} placeholder="0.00" />
        </div>
        <div className="form-row">
          <label className="form-label">Date *</label>
          <input type="date" className="input" value={form.date} onChange={e => f('date', e.target.value)} />
        </div>
      </div>
      <div className="form-grid">
        <div className="form-row">
          <label className="form-label">Method</label>
          <select className="select" value={form.method} onChange={e => f('method', e.target.value)}>
            <option value="bank_transfer">Bank Transfer</option>
            <option value="cash">Cash</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="form-row">
          <label className="form-label">Status</label>
          <select className="select" value={form.status} onChange={e => f('status', e.target.value)}>
            <option value="pending">Pending</option>
            <option value="received">Received</option>
          </select>
        </div>
      </div>
      <div className="form-row">
        <label className="form-label">Notes</label>
        <textarea className="input" value={form.notes} onChange={e => f('notes', e.target.value)} placeholder="Notes..." />
      </div>
      {err && <div className="error-msg">{err}</div>}
    </Modal>
  );
}

/* ---- Crew Assign Modal ---- */
function CrewAssignModal({ assign, projectId, crewList, onClose, onSaved, onAddCrew }) {
  const isEdit = !!assign?.id;
  const [form, setForm] = useState({
    crew_id: assign?.crew_id || '',
    role_on_project: assign?.role_on_project || '',
    days: assign?.days || 1,
    rate_per_day: assign?.rate_per_day || '',
    paid_status: assign?.paid_status || 'unpaid',
    payment_date: assign?.payment_date || '',
    payment_amount: assign?.payment_amount || '',
    payment_method: assign?.payment_method || 'bank_transfer',
    payment_notes: assign?.payment_notes || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  function f(k, v) {
    setForm(p => {
      const next = { ...p, [k]: v };
      if (k === 'paid_status' && v === 'paid') {
        next.payment_date = new Date().toISOString().split('T')[0];
      }
      return next;
    });
  }

  const total = (parseFloat(form.days) || 0) * (parseFloat(form.rate_per_day) || 0);

  async function save() {
    if (!isEdit && !form.crew_id) return setErr('Select a crew member');
    setSaving(true);
    try {
      if (isEdit) await api.put(`/projects/${projectId}/crew/${assign.id}`, form);
      else await api.post(`/projects/${projectId}/crew`, form);
      onSaved(); onClose();
    } catch (e) { setErr(e.message); }
    setSaving(false);
  }

  return (
    <Modal title={isEdit ? 'Edit Crew Assignment' : 'Add Crew'} onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
    </>}>
      {!isEdit && (
        <div className="form-row">
          <label className="form-label">Crew Member *</label>
          <select className="select" value={form.crew_id} onChange={e => {
            const crew = crewList.find(c => c.id === parseInt(e.target.value));
            f('crew_id', e.target.value);
            if (crew) { f('rate_per_day', crew.day_rate); f('role_on_project', crew.role || crew.service_type || ''); }
          }}>
            <option value="">Select crew</option>
            {crewList.map(c => <option key={c.id} value={c.id}>{c.name}{c.is_company ? ' 🏢' : ''} — {c.service_type || c.role || 'No role'}</option>)}
          </select>
          {onAddCrew && <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: '6px', fontSize: '11px' }} onClick={onAddCrew}><Plus size={11} /> Add New Crew</button>}
        </div>
      )}
      <div className="form-row">
        <label className="form-label">Role on Project</label>
        <input className="input" value={form.role_on_project} onChange={e => f('role_on_project', e.target.value)} placeholder="Role" />
      </div>
      <div className="form-grid">
        <div className="form-row">
          <label className="form-label">Days</label>
          <input type="number" min="1" className="input" value={form.days} onChange={e => f('days', e.target.value)} />
        </div>
        <div className="form-row">
          <label className="form-label">Rate/Day (€)</label>
          <input type="number" className="input" value={form.rate_per_day} onChange={e => f('rate_per_day', e.target.value)} placeholder="0.00" />
        </div>
      </div>
      <div className="text-sm text-2" style={{ marginBottom: '12px' }}>Total: <strong>{fmt(total)}</strong></div>
      <div className="form-row">
        <label className="form-label">Payment Status</label>
        <select className="select" value={form.paid_status} onChange={e => f('paid_status', e.target.value)}>
          <option value="unpaid">Unpaid</option>
          <option value="partial">Partial</option>
          <option value="paid">Paid</option>
        </select>
      </div>
      {form.paid_status !== 'unpaid' && (
        <>
          <div className="form-grid">
            <div className="form-row">
              <label className="form-label">Payment Date</label>
              <input type="date" className="input" value={form.payment_date} onChange={e => f('payment_date', e.target.value)} />
            </div>
            <div className="form-row">
              <label className="form-label">Amount Paid (€)</label>
              <input type="number" className="input" value={form.payment_amount} onChange={e => f('payment_amount', e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <label className="form-label">Payment Method</label>
            <select className="select" value={form.payment_method} onChange={e => f('payment_method', e.target.value)}>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="cash">Cash</option>
            </select>
          </div>
          <div className="form-row">
            <label className="form-label">Payment Notes</label>
            <textarea className="input" value={form.payment_notes} onChange={e => f('payment_notes', e.target.value)} />
          </div>
        </>
      )}
      {err && <div className="error-msg">{err}</div>}
    </Modal>
  );
}

/* ---- Expense Modal ---- */
function ExpenseModal({ expense, projectId, expCats, invoiceBlobUrls, onClose, onSaved }) {
  const isEdit = !!expense?.id;
  const [form, setForm] = useState({
    category_id: expense?.category_id || '',
    amount: expense?.amount || '',
    date: expense?.date || new Date().toISOString().slice(0, 10),
    notes: expense?.notes || '',
  });
  const [file, setFile] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = React.useRef();
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

  async function save() {
    if (!form.amount || !form.date) return setErr('Amount and date required');
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('category_id', form.category_id || '');
      fd.append('amount', form.amount);
      fd.append('date', form.date);
      fd.append('notes', form.notes || '');
      if (file) fd.append('invoice_image', file);

      if (isEdit) await api.putForm(`/projects/${projectId}/expenses/${expense.id}`, fd);
      else await api.postForm(`/projects/${projectId}/expenses`, fd);
      onSaved(); onClose();
    } catch (e) { setErr(e.message); }
    setSaving(false);
  }

  const existingImage = isEdit && expense?.invoice_image_path;

  return (
    <Modal title={isEdit ? 'Edit Expense' : 'Add Expense'} onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
    </>}>
      <div className="form-row">
        <label className="form-label">Category</label>
        <select className="select" value={form.category_id} onChange={e => f('category_id', e.target.value)}>
          <option value="">Uncategorized</option>
          {expCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="form-grid">
        <div className="form-row">
          <label className="form-label">Amount (€) *</label>
          <input type="number" className="input" value={form.amount} onChange={e => f('amount', e.target.value)} placeholder="0.00" />
        </div>
        <div className="form-row">
          <label className="form-label">Date *</label>
          <input type="date" className="input" value={form.date} onChange={e => f('date', e.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <label className="form-label">Notes</label>
        <textarea className="input" value={form.notes} onChange={e => f('notes', e.target.value)} placeholder="Notes..." />
      </div>
      <div className="form-row">
        <label className="form-label">Attach Invoice (optional)</label>
        {existingImage && !file && (
          <div className="text-xs text-2" style={{ marginBottom: '6px' }}>
            Current: {existingImage.endsWith('.pdf') ? <FileText size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> : (
              <img src={(invoiceBlobUrls || {})[existingImage] || ''} alt="current" style={{ width: '24px', height: '24px', objectFit: 'cover', borderRadius: '6px', verticalAlign: 'middle' }} />
            )} {existingImage}
          </div>
        )}
        {file ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', background: 'var(--card)', borderRadius: '6px', border: '1px solid var(--border)' }}>
            {filePreview && <img src={filePreview} alt="preview" style={{ width: '32px', height: '32px', objectFit: 'cover', borderRadius: '6px' }} />}
            {!filePreview && <FileText size={20} color="#737373" />}
            <span className="text-xs text-2" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setFile(null); setFilePreview(null); if (fileRef.current) fileRef.current.value = ''; }}><X size={12} /></button>
          </div>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} style={{ width: '100%', justifyContent: 'center' }}>
            <Image size={13} /> Choose File
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp,application/pdf"
          style={{ display: 'none' }}
          onChange={e => handleFile(e.target.files[0])}
        />
      </div>
      {err && <div className="error-msg">{err}</div>}
    </Modal>
  );
}

/* ---- Image Lightbox ---- */
function ImageLightbox({ src, filename, onClose }) {
  React.useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(10,10,10,0.45)', zIndex: 2000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <button
        onClick={onClose}
        style={{ position: 'absolute', top: '16px', right: '16px', background: 'rgba(10,10,10,0.05)', border: 'none', borderRadius: '50%', width: '36px', height: '36px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0a0a0a' }}
      >
        <X size={18} />
      </button>
      <img
        src={src}
        alt="Invoice"
        style={{ maxWidth: '90vw', maxHeight: '80vh', objectFit: 'contain', borderRadius: '10px' }}
      />
      <a
        href={src}
        download={filename}
        style={{ marginTop: '16px', background: 'rgba(10,10,10,0.06)', color: '#0a0a0a', border: 'none', borderRadius: '24px', padding: '10px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none', fontSize: '14px' }}
      >
        <Download size={16} /> Download
      </a>
    </div>
  );
}

/* ---- Revision Modal ---- */
function RevisionModal({ projectId, onClose, onSaved }) {
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), notes: '' });
  const [saving, setSaving] = useState(false);
  function f(k, v) { setForm(p => ({ ...p, [k]: v })); }

  async function save() {
    setSaving(true);
    try { await api.post(`/projects/${projectId}/revisions`, form); onSaved(); onClose(); }
    catch (e) { alert(e.message); }
    setSaving(false);
  }

  return (
    <Modal title="Add Revision Round" onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Add'}</button>
    </>}>
      <div className="form-row">
        <label className="form-label">Date</label>
        <input type="date" className="input" value={form.date} onChange={e => f('date', e.target.value)} />
      </div>
      <div className="form-row">
        <label className="form-label">Notes</label>
        <textarea className="input" value={form.notes} onChange={e => f('notes', e.target.value)} placeholder="Revision notes..." />
      </div>
    </Modal>
  );
}

/* ---- Edit Project Modal ---- */
function EditProjectModal({ project, projectId, onClose, onSaved }) {
  const [clients, setClients] = useState([]);
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState({
    title: project.title || '',
    client_id: project.client_id || '',
    category_id: project.category_id || '',
    status: project.status || 'development',
    client_budget: project.client_budget || '',
    agreed_budget: project.agreed_budget || '',
    deadline: project.deadline || '',
    shoot_date: project.shoot_date || '',
    shoot_days: project.shoot_days || 1,
    shoot_start_time: project.shoot_start_time || '',
    shoot_end_time: project.shoot_end_time || '',
    location_name: project.location_name || project.shoot_location || '',
    location_lat: project.location_lat || null,
    location_lng: project.location_lng || null,
    notes: project.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const [showNewClient, setShowNewClient] = useState(false);

  useEffect(() => {
    Promise.all([api.get('/clients'), api.get('/settings/project-categories')]).then(([cl, ca]) => {
      setClients(cl); setCategories(ca);
    });
  }, []);

  function f(k, v) { setForm(p => ({ ...p, [k]: v })); }

  const grouped = categories.reduce((acc, c) => {
    acc[c.group_name] = acc[c.group_name] || [];
    acc[c.group_name].push(c);
    return acc;
  }, {});

  const selectedCat = categories.find(c => c.id === parseInt(form.category_id));
  const isProduction = !!(selectedCat && PRODUCTION_GROUPS.includes(selectedCat.group_name));

  async function save() {
    setSaving(true);
    try {
      await api.put(`/projects/${projectId}`, {
        ...form,
        deadline: form.deadline || null,
        client_budget: parseFloat(form.client_budget) || 0,
        agreed_budget: parseFloat(form.agreed_budget) || 0,
        shoot_date: isProduction ? (form.shoot_date || null) : null,
        shoot_days: isProduction ? (parseInt(form.shoot_days) || 1) : 1,
        shoot_start_time: isProduction ? (form.shoot_start_time || null) : null,
        shoot_end_time: isProduction ? (form.shoot_end_time || null) : null,
        location_name: isProduction ? (form.location_name || null) : null,
        location_lat: isProduction ? (form.location_lat || null) : null,
        location_lng: isProduction ? (form.location_lng || null) : null,
      });
      onSaved(); onClose();
    } catch (e) { alert(e.message); }
    setSaving(false);
  }

  async function createClient(clientForm) {
    const newClient = await api.post('/clients', clientForm);
    const updated = await api.get('/clients');
    setClients(updated);
    f('client_id', String(newClient.id));
    setShowNewClient(false);
  }

  return (
    <>
      <Modal title="Edit Project" onClose={onClose} footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
      </>}>
        <div className="form-row">
          <label className="form-label">Title</label>
          <input className="input" value={form.title} onChange={e => f('title', e.target.value)} />
        </div>
        <div className="form-grid">
          <div className="form-row">
            <label className="form-label">Client</label>
            <select className="select" value={form.client_id} onChange={e => f('client_id', e.target.value)}>
              <option value="">No client</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: '6px', fontSize: '11px' }} onClick={() => setShowNewClient(true)}>
              <Plus size={11} /> Add New Client
            </button>
          </div>
          <div className="form-row">
            <label className="form-label">Status</label>
            <select className="select" value={form.status} onChange={e => f('status', e.target.value)}>
              {['development','pre-production','production','post-production','completed'].map(s => (
                <option key={s} value={s}>{s.replace(/-/g,' ')}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-row">
          <label className="form-label">Category</label>
          <select className="select" value={form.category_id} onChange={e => f('category_id', e.target.value)}>
            <option value="">No category</option>
            {Object.entries(grouped).map(([g, cats]) => (
              <optgroup key={g} label={g}>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
            ))}
          </select>
        </div>
        <div className="form-grid">
          <div className="form-row">
            <label className="form-label">Client Budget (€)</label>
            <input type="number" className="input" value={form.client_budget} onChange={e => f('client_budget', e.target.value)} />
          </div>
          <div className="form-row">
            <label className="form-label">Agreed Budget (€)</label>
            <input type="number" className="input" value={form.agreed_budget} onChange={e => f('agreed_budget', e.target.value)} />
          </div>
        </div>
        <div className="form-row">
          <label className="form-label">Deadline</label>
          <input type="date" className="input" value={form.deadline} onChange={e => f('deadline', e.target.value)} />
        </div>
        {isProduction && (
          <>
            <div className="form-grid">
              <div className="form-row">
                <label className="form-label">Shoot Date</label>
                <input type="date" className="input" value={form.shoot_date} onChange={e => f('shoot_date', e.target.value)} />
              </div>
              <div className="form-row">
                <label className="form-label">Shoot Days</label>
                <input type="number" min="1" max="30" className="input" value={form.shoot_days} onChange={e => f('shoot_days', e.target.value)} />
              </div>
            </div>
            <div className="form-grid">
              <div className="form-row">
                <label className="form-label">Shoot Start Time</label>
                <input type="time" className="input" value={form.shoot_start_time} onChange={e => f('shoot_start_time', e.target.value)} />
              </div>
              <div className="form-row">
                <label className="form-label">Shoot End Time</label>
                <input type="time" className="input" value={form.shoot_end_time} onChange={e => f('shoot_end_time', e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <label className="form-label">Location</label>
              <LocationPicker
                value={form.location_name}
                lat={form.location_lat}
                lng={form.location_lng}
                onChange={loc => setForm(p => ({ ...p, location_name: loc.location_name, location_lat: loc.location_lat, location_lng: loc.location_lng }))}
              />
            </div>
          </>
        )}
        <div className="form-row">
          <label className="form-label">Notes</label>
          <textarea className="input" value={form.notes} onChange={e => f('notes', e.target.value)} />
        </div>
      </Modal>
      {showNewClient && (
        <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={e => e.target === e.currentTarget && setShowNewClient(false)}>
          <div className="modal-box">
            <div className="modal-header">
              <span className="modal-title">New Client</span>
              <button className="modal-close" onClick={() => setShowNewClient(false)}><X size={18} /></button>
            </div>
            <InlineClientForm onSave={createClient} onClose={() => setShowNewClient(false)} />
          </div>
        </div>
      )}
    </>
  );
}

/* ---- Delete Project Modal ---- */
function DeleteProjectModal({ projectTitle, onClose, onConfirm }) {
  const [deleting, setDeleting] = useState(false);

  async function confirm() {
    setDeleting(true);
    try { await onConfirm(); }
    catch (e) { alert(e.message); setDeleting(false); }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: '480px' }}>
        <div className="modal-header">
          <span className="modal-title">Delete Project</span>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <p className="text-2 text-sm" style={{ marginBottom: '20px', lineHeight: '1.6' }}>
          Are you sure you want to delete <strong style={{ color: '#0a0a0a' }}>{projectTitle}</strong>? This will permanently delete all tasks, phases, crew assignments, expenses, and payments linked to this project.
        </p>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={deleting}>Cancel</button>
          <button className="btn btn-danger" onClick={confirm} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Confirm Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---- Duplicate Modal ---- */
function DuplicateModal({ project, onClose, onDone }) {
  const defaultTitle = `Copy of ${project.title}`;
  const [title, setTitle] = useState(defaultTitle);
  const [allTitles, setAllTitles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/projects').then(ps => setAllTitles(ps.map(p => p.title)));
  }, []);

  const isChanged = title.trim() !== defaultTitle;
  const isUnique = !allTitles.includes(title.trim());
  const canSave = isChanged && isUnique && title.trim().length > 0;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const result = await api.post(`/projects/${project.id}/duplicate`, { title: title.trim() });
      onDone(result.id);
    } catch (e) { setErr(e.message); setSaving(false); }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: '480px' }}>
        <div className="modal-header">
          <span className="modal-title">Duplicate Project</span>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="form-row">
          <label className="form-label">New Project Title</label>
          <input
            className="input"
            value={title}
            onChange={e => { setTitle(e.target.value); setErr(''); }}
            autoFocus
            onKeyDown={e => e.key === 'Enter' && save()}
          />
          {!isChanged && title.trim() === defaultTitle && (
            <div className="text-xs text-2 mt-1">Change the title before saving</div>
          )}
          {isChanged && !isUnique && (
            <div className="error-msg">A project with this title already exists</div>
          )}
        </div>
        <div className="text-xs text-2" style={{ marginBottom: '16px', lineHeight: '1.6' }}>
          Tasks will be copied (status reset to To Do). Crew assignments, payments, and expenses will not be copied.
        </div>
        {err && <div className="error-msg">{err}</div>}
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={!canSave || saving}>
            {saving ? 'Duplicating...' : 'Duplicate'}
          </button>
        </div>
      </div>
    </div>
  );
}

function InlineClientForm({ onSave, onClose }) {
  const [form, setForm] = useState({ name: '', company: '', phone: '', email: '', socials: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  function f(k, v) { setForm(p => ({ ...p, [k]: v })); }
  async function save() {
    if (!form.name.trim()) { setErr('Name required'); return; }
    setSaving(true);
    try { await onSave(form); } catch (e) { setErr(e.message); setSaving(false); }
  }
  return (
    <>
      <div className="form-row"><label className="form-label">Name *</label><input className="input" value={form.name} onChange={e => f('name', e.target.value)} autoFocus /></div>
      <div className="form-row"><label className="form-label">Company</label><input className="input" value={form.company} onChange={e => f('company', e.target.value)} /></div>
      <div className="form-grid">
        <div className="form-row"><label className="form-label">Phone</label><input className="input" value={form.phone} onChange={e => f('phone', e.target.value)} /></div>
        <div className="form-row"><label className="form-label">Email</label><input type="email" className="input" value={form.email} onChange={e => f('email', e.target.value)} /></div>
      </div>
      {err && <div className="error-msg">{err}</div>}
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Create & Select'}</button>
      </div>
    </>
  );
}
