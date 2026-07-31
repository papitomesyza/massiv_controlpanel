import React, { useEffect, useState } from 'react';
import { Plus, FileText, Trash2, Download, Pencil, Receipt } from 'lucide-react';
import { api, fmt, fmtDate } from '../api';
import { useNavigate } from 'react-router-dom';
import BudgetWizard from '../components/BudgetWizard';

export default function Budgets() {
  const navigate = useNavigate();
  const [budgets, setBudgets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);
  const [editingBudget, setEditingBudget] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [creatingInvoice, setCreatingInvoice] = useState(null);

  async function load() {
    try {
      const data = await api.get('/budgets');
      setBudgets(data);
    } catch (_) {}
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(budget) {
    if (!window.confirm(`Delete investment estimation "${budget.title}"? This cannot be undone.`)) return;
    setDeleting(budget.id);
    try {
      await api.del(`/budgets/${budget.id}`);
      load();
    } catch (e) { alert(e.message); }
    setDeleting(null);
  }

  async function handleExportPdf(budget) {
    try {
      await api.download(`/budgets/${budget.id}/pdf`, `Investment-Estimation-${budget.title.replace(/[^a-z0-9]/gi, '-')}.pdf`);
    } catch (e) { alert(e.message); }
  }

  async function handleEdit(budget) {
    try {
      const full = await api.get(`/budgets/${budget.id}`);
      setEditingBudget(full);
      setShowWizard(true);
    } catch (e) { alert(e.message); }
  }

  function handleNew() {
    setEditingBudget(null);
    setShowWizard(true);
  }

  async function handleCreateInvoice(budget) {
    setCreatingInvoice(budget.id);
    try {
      await api.post(`/invoices/from-estimate/${budget.id}`, {});
      navigate('/invoices');
    } catch (e) {
      alert(e.message);
    }
    setCreatingInvoice(null);
  }

  function handleWizardClose() {
    setShowWizard(false);
    setEditingBudget(null);
  }

  function handleWizardSaved() {
    setShowWizard(false);
    setEditingBudget(null);
    load();
  }

  function statusBadge(status) {
    if (status === 'finalized') return (
      <span className="badge" style={{ background: 'rgba(10,10,10,0.06)', color: '#0a0a0a' }}>Finalized</span>
    );
    return (
      <span className="badge" style={{ background: 'rgba(10,10,10,0.05)', color: 'var(--accent)' }}>Draft</span>
    );
  }

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Estimates</div>
          <div className="page-subtitle">Investment estimation proposals for clients</div>
        </div>
        <button className="btn btn-primary" onClick={handleNew}>
          <Plus size={15} /> New Estimate
        </button>
      </div>

      <div className="card">
        {budgets.length === 0 ? (
          <div className="empty" style={{ padding: '64px 32px' }}>
            <FileText size={40} color="#d4d4d4" style={{ marginBottom: '16px' }} />
            <div style={{ marginBottom: '8px', color: '#0a0a0a', fontWeight: 600, fontSize: '16px' }}>No estimates yet</div>
            <div style={{ marginBottom: '24px' }}>Create your first estimate.</div>
            <button className="btn btn-primary" onClick={handleNew}><Plus size={15} /> New Estimate</button>
          </div>
        ) : (
          <div className="table-wrap table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Linked Project</th>
                  <th>Category</th>
                  <th>Client</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th style={{ width: '120px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {budgets.map(b => (
                  <tr key={b.id}>
                    <td data-label="Title">
                      <button
                        onClick={() => handleEdit(b)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#0a0a0a', fontWeight: 600, fontSize: '14px', padding: 0, textAlign: 'left' }}
                      >
                        {b.title}
                      </button>
                    </td>
                    <td data-label="Project" className="text-2">{b.project_title || <span style={{ color: '#737373' }}>—</span>}</td>
                    <td data-label="Category" className="text-2" style={{ fontSize: '12px' }}>{b.category}</td>
                    <td data-label="Client" className="text-2">{b.client_name || <span style={{ color: '#737373' }}>—</span>}</td>
                    <td data-label="Total" style={{ fontWeight: 600 }}>{fmt(b.total)}</td>
                    <td data-label="Status">{statusBadge(b.status)}</td>
                    <td data-label="Date" className="text-2" style={{ fontSize: '12px' }}>{fmtDate(b.created_at?.split('T')[0] || b.created_at?.split(' ')[0])}</td>
                    <td className="mobile-actions">
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <button className="btn-icon" title="Edit" onClick={() => handleEdit(b)}>
                          <Pencil size={14} />
                        </button>
                        <button className="btn-icon" title="Export PDF" onClick={() => handleExportPdf(b)}>
                          <Download size={14} />
                        </button>
                        <button
                          className="btn-icon"
                          title="Create Invoice from this estimate"
                          onClick={() => handleCreateInvoice(b)}
                          disabled={creatingInvoice === b.id}
                          style={{ color: 'var(--accent)' }}
                        >
                          <Receipt size={14} />
                        </button>
                        <button
                          className="btn-icon"
                          title="Delete"
                          onClick={() => handleDelete(b)}
                          disabled={deleting === b.id}
                          style={{ color: '#e7000b' }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showWizard && (
        <BudgetWizard
          budget={editingBudget}
          onClose={handleWizardClose}
          onSaved={handleWizardSaved}
        />
      )}
    </div>
  );
}
