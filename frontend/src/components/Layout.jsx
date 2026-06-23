import React, { useEffect, useState, useRef } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, FolderKanban, Users, UserCog, Package,
  BarChart3, FileText, Settings, LogOut, CalendarDays, MapPin, Receipt,
  Plus, X, Lightbulb,
} from 'lucide-react';
import { useAgency } from '../context/AgencyContext';
import { api } from '../api';
import SetupWizard from './SetupWizard';

const OPS_LINKS = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/projects',  icon: FolderKanban,   label: 'Projects'  },
  { to: '/calendar',  icon: CalendarDays,    label: 'Calendar'  },
  { to: '/map',       icon: MapPin,          label: 'Map'       },
  { to: '/finances',  icon: BarChart3,       label: 'Finances'  },
  { to: '/budgets',   icon: FileText,        label: 'Estimates' },
  { to: '/invoices',  icon: Receipt,         label: 'Invoices'  },
];

const DB_LINKS = [
  { to: '/clients',   icon: Users,           label: 'Clients'   },
  { to: '/crew',      icon: UserCog,         label: 'Crew'      },
  { to: '/assets',    icon: Package,         label: 'Assets'    },
];

const ALL_LINKS = [...OPS_LINKS, ...DB_LINKS, { to: '/settings', icon: Settings, label: 'Settings' }];

const MOBILE_NAV_LINKS = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Home' },
  { to: '/projects',  icon: FolderKanban,   label: 'Projects' },
  { to: '/finances',  icon: BarChart3,       label: 'Finances' },
  { to: '/invoices',  icon: Receipt,         label: 'Invoices' },
  { to: '/settings',  icon: Settings,        label: 'Settings' },
];

const FAB_ACTIONS = [
  { label: 'New Project',  icon: FolderKanban, to: '/projects?new=1' },
  { label: 'New Estimate', icon: FileText,     to: '/budgets' },
  { label: 'New Invoice',  icon: Receipt,      to: '/invoices' },
  { label: 'New Lead',     icon: Lightbulb,    to: '/projects?newlead=1' },
];

function fmtShortDate(d) {
  if (!d) return '';
  const date = new Date(d + 'T00:00:00');
  if (isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}

export default function Layout() {
  const navigate = useNavigate();
  const { name, tagline, logo } = useAgency();
  const [upcoming, setUpcoming] = useState([]);
  const [fabOpen, setFabOpen] = useState(false);
  const fabRef = useRef(null);
  const [showSetupWizard, setShowSetupWizard] = useState(false);

  useEffect(() => {
    api.get('/calendar/upcoming?limit=3').then(setUpcoming).catch(() => {});
  }, []);

  useEffect(() => {
    if (sessionStorage.getItem('massiv_setup_skipped')) return;
    api.get('/settings/profile').then(p => {
      if (!p.profile_completed) setShowSetupWizard(true);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!fabOpen) return;
    function handleClick(e) {
      if (fabRef.current && !fabRef.current.contains(e.target)) {
        setFabOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [fabOpen]);

  async function logout() {
    try { await api.post('/auth/logout', {}); } catch (_) {}
    localStorage.removeItem('massiv_auth');
    navigate('/login');
  }

  function handleFabAction(to) {
    setFabOpen(false);
    navigate(to);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          {logo ? (
            <img
              src={logo}
              alt="Logo"
              style={{ maxHeight: '44px', width: 'auto', maxWidth: '100%', objectFit: 'contain', display: 'block' }}
            />
          ) : (
            <div>
              <div>{name}</div>
              {tagline && (
                <div style={{ fontSize: '10px', color: '#888888', fontWeight: 400, marginTop: '2px', letterSpacing: '0' }}>
                  {tagline}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          <nav className="sidebar-nav">
            <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#444', padding: '4px 16px 6px', userSelect: 'none' }}>
              Operations
            </div>
            {OPS_LINKS.map(({ to, icon: Icon, label }) => (
              <NavLink key={to} to={to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                <div className="nav-icon"><Icon size={18} /></div>
                {label}
              </NavLink>
            ))}

            <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '8px 16px' }} />

            <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#444', padding: '4px 16px 6px', userSelect: 'none' }}>
              Database
            </div>
            {DB_LINKS.map(({ to, icon: Icon, label }) => (
              <NavLink key={to} to={to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                <div className="nav-icon"><Icon size={18} /></div>
                {label}
              </NavLink>
            ))}
          </nav>

          {upcoming.length > 0 && (
            <div className="sidebar-upcoming" onClick={() => navigate('/calendar')} style={{ cursor: 'pointer' }}>
              <div className="sidebar-upcoming-title">Upcoming</div>
              {upcoming.map(ev => (
                <div key={ev.id} className="sidebar-upcoming-item">
                  <span className="sidebar-upcoming-dot" style={{ background: ev.color || '#723CEB' }} />
                  <div className="sidebar-upcoming-info">
                    <span className="sidebar-upcoming-name">{ev.title.length > 22 ? ev.title.slice(0, 22) + '…' : ev.title}</span>
                    <span className="sidebar-upcoming-date">{fmtShortDate(ev.start_date)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="sidebar-footer">
          <NavLink to="/settings" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            <div className="nav-icon"><Settings size={18} /></div>
            Settings
          </NavLink>
          <button className="logout-btn" onClick={logout}>
            <div className="nav-icon"><LogOut size={18} /></div>
            Logout
          </button>
          <div className="built-by">built by year28</div>
        </div>
      </aside>

      <div className="main-content">
        <div className="page-inner">
          <Outlet />
        </div>
        <footer className="page-footer">built by year28</footer>
      </div>

      {/* Sticky FAB */}
      <div className="fab-wrap" ref={fabRef}>
        {fabOpen && (
          <div className="fab-menu">
            {FAB_ACTIONS.map(({ label, icon: Icon, to }) => (
              <button key={label} className="fab-item" onClick={() => handleFabAction(to)}>
                <span className="fab-item-icon"><Icon size={15} /></span>
                {label}
              </button>
            ))}
          </div>
        )}
        <button className="fab-btn" onClick={() => setFabOpen(o => !o)} aria-label="Quick actions">
          {fabOpen ? <X size={20} /> : <Plus size={20} />}
        </button>
      </div>

      <nav className="bottom-nav">
        <div className="bottom-nav-inner">
          {MOBILE_NAV_LINKS.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
              <Icon size={20} />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>

      {showSetupWizard && (
        <SetupWizard
          onComplete={() => setShowSetupWizard(false)}
          onSkip={() => {
            sessionStorage.setItem('massiv_setup_skipped', '1');
            setShowSetupWizard(false);
          }}
          onDismissPermanently={() => setShowSetupWizard(false)}
        />
      )}
    </div>
  );
}
