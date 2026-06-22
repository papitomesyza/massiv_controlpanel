import React, { useEffect, useState, useRef } from 'react';
import { Plus, Trash2, Palette, Image as ImageIcon, Receipt } from 'lucide-react';
import { api } from '../api';
import { useNavigate } from 'react-router-dom';

export default function Settings() {
  const navigate = useNavigate();
  const [expCats, setExpCats] = useState([]);
  const [projCats, setProjCats] = useState([]);
  const [crewRoles, setCrewRoles] = useState([]);
  const [newExpCat, setNewExpCat] = useState('');
  const [newProjCat, setNewProjCat] = useState({ name: '', group_name: '' });
  const [newRole, setNewRole] = useState('');
  const [password, setPassword] = useState({ currentPass: '', newPass: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState('');
  const [loading, setLoading] = useState(true);

  const [taxRate, setTaxRate] = useState('18');
  const [taxLabel, setTaxLabel] = useState('Tax');
  const [taxEnabled, setTaxEnabled] = useState(true);
  const [taxMsg, setTaxMsg] = useState('');

  const [logo, setLogo] = useState(() => localStorage.getItem('massiv_logo'));
  const [agencyName, setAgencyName] = useState(() => localStorage.getItem('massiv_agency_name') || 'MASSIV TV');
  const [agencyTagline, setAgencyTagline] = useState(() => localStorage.getItem('massiv_agency_tagline') || '');
  const [favicon, setFavicon] = useState(() => localStorage.getItem('massiv_favicon'));
  const [brandingMsg, setBrandingMsg] = useState('');

  const fileInputRef = useRef(null);
  const faviconInputRef = useRef(null);

  function handleLogoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target.result;
      localStorage.setItem('massiv_logo', base64);
      setLogo(base64);
      window.dispatchEvent(new Event('logoUpdated'));
      api.post('/settings/logo', { base64 }).catch(() => {});
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function handleRemoveLogo() {
    localStorage.removeItem('massiv_logo');
    setLogo(null);
    window.dispatchEvent(new Event('logoUpdated'));
    api.post('/settings/logo', { base64: '' }).catch(() => {});
  }

  function handleFaviconUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setFavicon(ev.target.result);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function handleRemoveFavicon() {
    setFavicon(null);
  }

  async function saveBranding() {
    const name = agencyName.trim() || 'MASSIV TV';
    const tagline = agencyTagline.trim();

    localStorage.setItem('massiv_agency_name', name);
    localStorage.setItem('massiv_agency_tagline', tagline);
    window.dispatchEvent(new Event('agencyNameUpdated'));

    if (favicon) {
      localStorage.setItem('massiv_favicon', favicon);
    } else {
      localStorage.removeItem('massiv_favicon');
    }
    window.dispatchEvent(new Event('faviconUpdated'));

    try {
      const logoBase64 = logo || null;
      await api.post('/settings/agency', {
        agency_name: name,
        agency_tagline: tagline,
        agency_logo_base64: logoBase64,
      });
      setBrandingMsg('Branding saved');
    } catch {
      setBrandingMsg('Saved locally (backend error)');
    }
    setTimeout(() => setBrandingMsg(''), 3000);
  }

  async function load() {
    const [ec, pc, cr, tax] = await Promise.all([
      api.get('/settings/expense-categories'),
      api.get('/settings/project-categories'),
      api.get('/settings/crew-roles'),
      api.get('/settings/tax'),
    ]);
    setExpCats(ec); setProjCats(pc); setCrewRoles(cr);
    setTaxRate(String(tax.tax_rate ?? 18));
    setTaxLabel(tax.tax_label || 'Tax');
    setTaxEnabled(tax.tax_enabled !== false);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function saveTax() {
    const rate = parseFloat(taxRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) return setTaxMsg('Rate must be 0–100');
    try {
      await api.post('/settings/tax', { tax_rate: rate, tax_label: taxLabel.trim() || 'Tax', tax_enabled: taxEnabled });
      setTaxMsg('Saved');
    } catch { setTaxMsg('Error saving'); }
    setTimeout(() => setTaxMsg(''), 3000);
  }

  async function addExpCat() {
    if (!newExpCat.trim()) return;
    try { await api.post('/settings/expense-categories', { name: newExpCat.trim() }); setNewExpCat(''); load(); }
    catch (e) { alert(e.message); }
  }

  async function delExpCat(id) {
    try { await api.del(`/settings/expense-categories/${id}`); load(); }
    catch (e) { alert(e.message); }
  }

  async function addProjCat() {
    if (!newProjCat.name.trim() || !newProjCat.group_name.trim()) return alert('Both name and group required');
    try { await api.post('/settings/project-categories', newProjCat); setNewProjCat({ name: '', group_name: '' }); load(); }
    catch (e) { alert(e.message); }
  }

  async function delProjCat(id) {
    try { await api.del(`/settings/project-categories/${id}`); load(); }
    catch (e) { alert(e.message); }
  }

  async function addCrewRole() {
    if (!newRole.trim()) return;
    try { await api.post('/settings/crew-roles', { name: newRole.trim() }); setNewRole(''); load(); }
    catch (e) { alert(e.message); }
  }

  async function delCrewRole(id) {
    try { await api.del(`/settings/crew-roles/${id}`); load(); }
    catch (e) { alert(e.message); }
  }

  async function changePassword() {
    if (!password.currentPass) return setPwMsg('Enter your current password');
    if (!password.newPass) return setPwMsg('Enter a new password');
    if (password.newPass !== password.confirm) return setPwMsg('Passwords do not match');
    if (password.newPass.length < 8) return setPwMsg('Min 8 characters');
    try {
      const data = await api.post('/settings/change-password', { currentPassword: password.currentPass, newPassword: password.newPass });
      localStorage.setItem('massiv_auth', data.token);
      setPwMsg('Password changed successfully');
      setPassword({ currentPass: '', newPass: '', confirm: '' });
    } catch (e) { setPwMsg(e.message); }
  }

  async function downloadBackup() {
    try { await api.download('/settings/backup/download', `massiv-backup-${new Date().toISOString().slice(0, 10)}.db`); }
    catch (e) { alert(e.message); }
  }

  const projCatGroups = projCats.reduce((acc, c) => {
    acc[c.group_name] = acc[c.group_name] || [];
    acc[c.group_name].push(c);
    return acc;
  }, {});

  const groupOptions = [...new Set(['Video Production','Photography','Post Production','Branding & Digital', ...projCats.map(c => c.group_name)])];

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Settings</div>
      </div>

      <div className="settings-grid">

        {/* Agency Branding */}
        <div className="card card-pad span-2">
          <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
            <Palette size={16} />
            Agency Branding
          </div>

          {/* Logo row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '24px' }}>
            <div style={{ flexShrink: 0 }}>
              {logo
                ? <img src={logo} alt="Agency Logo" style={{ maxHeight: '80px', width: 'auto', maxWidth: '200px', objectFit: 'contain', display: 'block' }} />
                : <div style={{
                    width: '120px', height: '80px', borderRadius: '10px',
                    border: '1.5px dashed rgba(255,255,255,0.15)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '6px'
                  }}>
                    <ImageIcon size={22} color="#555555" />
                    <span style={{ fontSize: '10px', color: '#555555' }}>No logo uploaded</span>
                  </div>
              }
            </div>
            <div>
              <div style={{ fontWeight: 700, color: '#fff', marginBottom: '4px' }}>Agency Logo</div>
              <div style={{ fontSize: '12px', color: '#888888', marginBottom: '14px' }}>
                Displayed in the sidebar. Recommended: square image, min 128×128px
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-primary btn-sm" onClick={() => fileInputRef.current?.click()}>
                  Upload Logo
                </button>
                {logo && (
                  <button className="btn btn-danger btn-sm" onClick={handleRemoveLogo}>
                    Remove Logo
                  </button>
                )}
              </div>
            </div>
          </div>
          <input type="file" accept="image/*" ref={fileInputRef} style={{ display: 'none' }} onChange={handleLogoUpload} />

          {/* Divider */}
          <div style={{ borderTop: '1px solid var(--border)', marginBottom: '20px' }} />

          {/* Agency Name */}
          <div className="form-row">
            <label className="form-label">Agency Name</label>
            <input
              className="input"
              value={agencyName}
              onChange={e => setAgencyName(e.target.value)}
              placeholder="MASSIV TV"
            />
            <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>
              Shown in the sidebar wordmark, login page, and browser tab title.
            </div>
          </div>

          {/* Agency Tagline */}
          <div className="form-row">
            <label className="form-label">Tagline / Description</label>
            <input
              className="input"
              value={agencyTagline}
              onChange={e => setAgencyTagline(e.target.value)}
              placeholder="Creative Agency OS"
            />
            <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>
              Shown below the agency name in the sidebar and on the login page.
            </div>
          </div>

          {/* Favicon */}
          <div className="form-row" style={{ marginBottom: '0' }}>
            <label className="form-label">Favicon</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {favicon && (
                <img
                  src={favicon}
                  alt="Favicon preview"
                  style={{ width: '32px', height: '32px', objectFit: 'contain', borderRadius: '4px', border: '1px solid var(--border)', background: '#242424', flexShrink: 0 }}
                />
              )}
              <button className="btn btn-primary btn-sm" onClick={() => faviconInputRef.current?.click()}>
                {favicon ? 'Replace Favicon' : 'Upload Favicon'}
              </button>
              {favicon && (
                <button className="btn btn-danger btn-sm" onClick={handleRemoveFavicon}>
                  Remove
                </button>
              )}
            </div>
            <div style={{ fontSize: '11px', color: '#666', marginTop: '6px' }}>
              Accepts PNG, ICO, SVG, JPEG. Applied immediately to the browser tab.
            </div>
          </div>
          <input
            type="file"
            accept="image/png,image/x-icon,image/svg+xml,image/jpeg"
            ref={faviconInputRef}
            style={{ display: 'none' }}
            onChange={handleFaviconUpload}
          />

          {/* Save button */}
          <div style={{ marginTop: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button className="btn btn-primary" onClick={saveBranding}>Save Branding</button>
            {brandingMsg && (
              <span style={{ fontSize: '12px', color: '#aaa' }}>{brandingMsg}</span>
            )}
          </div>
        </div>

        {/* Expense Categories */}
        <div className="card card-pad">
          <div className="section-title" style={{ marginBottom: '12px' }}>Expense Categories</div>
          <div style={{ marginBottom: '12px' }}>
            {expCats.map(c => (
              <div key={c.id} className="list-item">
                <span className="text-sm">{c.name}</span>
                <div className="flex-center gap-2">
                  {c.is_default ? <span className="text-xs text-2">default</span> : (
                    <button className="btn btn-danger btn-sm" onClick={() => delExpCat(c.id)}><Trash2 size={12} /></button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="flex-center gap-2">
            <input className="input" placeholder="New category..." value={newExpCat} onChange={e => setNewExpCat(e.target.value)} onKeyDown={e => e.key === 'Enter' && addExpCat()} />
            <button className="btn btn-ghost btn-sm" onClick={addExpCat}><Plus size={13} /></button>
          </div>
        </div>

        {/* Crew Roles */}
        <div className="card card-pad">
          <div className="section-title" style={{ marginBottom: '12px' }}>Crew Roles</div>
          <div style={{ marginBottom: '12px' }}>
            {crewRoles.map(r => (
              <div key={r.id} className="list-item">
                <span className="text-sm">{r.name}</span>
                {r.is_default ? <span className="text-xs text-2">default</span> : (
                  <button className="btn btn-danger btn-sm" onClick={() => delCrewRole(r.id)}><Trash2 size={12} /></button>
                )}
              </div>
            ))}
          </div>
          <div className="flex-center gap-2">
            <input className="input" placeholder="New role..." value={newRole} onChange={e => setNewRole(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCrewRole()} />
            <button className="btn btn-ghost btn-sm" onClick={addCrewRole}><Plus size={13} /></button>
          </div>
        </div>

        {/* Project Categories */}
        <div className="card card-pad span-2">
          <div className="section-title" style={{ marginBottom: '12px' }}>Project Categories</div>
          <div style={{ marginBottom: '16px' }}>
            {Object.entries(projCatGroups).map(([group, cats]) => (
              <div key={group} style={{ marginBottom: '12px' }}>
                <div className="text-xs text-2" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>{group}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {cats.map(c => (
                    <div key={c.id} className="flex-center gap-1" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', borderRadius: '6px', padding: '4px 10px', fontSize: '12px' }}>
                      <span>{c.name}</span>
                      {!c.is_default && (
                        <button onClick={() => delProjCat(c.id)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: '0 0 0 4px' }}>
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex-center gap-2" style={{ flexWrap: 'wrap' }}>
            <input className="input" style={{ maxWidth: '220px' }} placeholder="Category name..." value={newProjCat.name} onChange={e => setNewProjCat(p => ({ ...p, name: e.target.value }))} />
            <select className="select" style={{ maxWidth: '180px' }} value={newProjCat.group_name} onChange={e => setNewProjCat(p => ({ ...p, group_name: e.target.value }))}>
              <option value="">Select group</option>
              {groupOptions.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <button className="btn btn-ghost btn-sm" onClick={addProjCat}><Plus size={13} /> Add</button>
          </div>
        </div>

        {/* Tax Configuration */}
        <div className="card card-pad">
          <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <Receipt size={15} />
            Tax Configuration
          </div>
          <div className="form-row">
            <label className="form-label">Tax Name / Label</label>
            <input
              className="input"
              value={taxLabel}
              onChange={e => setTaxLabel(e.target.value)}
              placeholder="e.g. VAT, Turnover Tax, GST"
            />
            <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>
              Shown wherever tax is displayed on invoices and in the Finances section.
            </div>
          </div>
          <div className="form-row">
            <label className="form-label">Tax Rate (%)</label>
            <input
              className="input"
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={taxRate}
              onChange={e => setTaxRate(e.target.value)}
              placeholder="e.g. 18"
              style={{ maxWidth: '140px' }}
            />
            <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>
              Applied to invoice totals when generating invoices. You set this — no auto-switching.
            </div>
          </div>
          <div className="form-row" style={{ marginBottom: '0' }}>
            <label className="form-label">Tax Tracking</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={taxEnabled}
                onChange={e => setTaxEnabled(e.target.checked)}
                style={{ width: '16px', height: '16px', accentColor: '#723CEB' }}
              />
              <span style={{ fontSize: '13px' }}>Enable tax tracking in Finances</span>
            </label>
          </div>
          <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button className="btn btn-primary" onClick={saveTax}>Save Tax Settings</button>
            {taxMsg && <span style={{ fontSize: '12px', color: taxMsg === 'Saved' ? '#4CAF50' : '#FF4444' }}>{taxMsg}</span>}
          </div>
        </div>

        {/* Password */}
        <div className="card card-pad">
          <div className="section-title" style={{ marginBottom: '12px' }}>Change Password</div>
          <div className="form-row">
            <label className="form-label">Current Password</label>
            <input type="password" className="input" value={password.currentPass} onChange={e => setPassword(p => ({ ...p, currentPass: e.target.value }))} placeholder="Current password" />
          </div>
          <div className="form-row">
            <label className="form-label">New Password</label>
            <input type="password" className="input" value={password.newPass} onChange={e => setPassword(p => ({ ...p, newPass: e.target.value }))} placeholder="New password (min 8 chars)" />
          </div>
          <div className="form-row">
            <label className="form-label">Confirm Password</label>
            <input type="password" className="input" value={password.confirm} onChange={e => setPassword(p => ({ ...p, confirm: e.target.value }))} placeholder="Confirm" />
          </div>
          {pwMsg && <div style={{ fontSize: '12px', color: pwMsg.includes('success') ? '#aaa' : '#FF4444', marginBottom: '12px' }}>{pwMsg}</div>}
          <button className="btn btn-primary" onClick={changePassword}>Update Password</button>
        </div>

        {/* Data Management */}
        <div className="card card-pad">
          <div className="section-title" style={{ marginBottom: '12px' }}>Data Management</div>
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '14px' }}>
            Download a full backup of the database file. Keep this safe — it contains all your project data.
          </div>
          <button className="btn btn-ghost" onClick={downloadBackup}>
            Download Backup
          </button>
        </div>

      </div>
    </div>
  );
}
