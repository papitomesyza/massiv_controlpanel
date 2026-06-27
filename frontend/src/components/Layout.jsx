import React, { useEffect, useState, useRef } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, FolderKanban, Users, UserCog, Package,
  BarChart3, FileText, Settings, LogOut, CalendarDays, MapPin, Receipt,
  Plus, X, Lightbulb, LayoutGrid, Library, ChevronRight, KeyRound,
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

const MIND_LINKS = [
  { to: '/collections', icon: Library,   label: 'Collections' },
  { to: '/accounts',    icon: KeyRound,  label: 'Accounts'    },
];

// All pages — used by the floating menu button for full-nav access
const ALL_NAV_PAGES = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Home'      },
  { to: '/projects',  icon: FolderKanban,    label: 'Projects'  },
  { to: '/calendar',  icon: CalendarDays,    label: 'Calendar'  },
  { to: '/finances',  icon: BarChart3,       label: 'Finances'  },
  { to: '/invoices',  icon: Receipt,         label: 'Invoices'  },
  { to: '/map',       icon: MapPin,          label: 'Map'       },
  { to: '/budgets',   icon: FileText,        label: 'Estimates' },
  { to: '/clients',   icon: Users,           label: 'Clients'   },
  { to: '/crew',      icon: UserCog,         label: 'Crew'      },
  { to: '/assets',    icon: Package,         label: 'Assets'    },
  { to: '/collections', icon: Library,       label: 'Collections' },
  { to: '/accounts',    icon: KeyRound,      label: 'Accounts'    },
  { to: '/settings',  icon: Settings,        label: 'Settings'  },
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

function getGroupForPath(pathname) {
  if (OPS_LINKS.some(l => pathname.startsWith(l.to))) return 'ops';
  if (DB_LINKS.some(l => pathname.startsWith(l.to))) return 'db';
  if (MIND_LINKS.some(l => pathname.startsWith(l.to))) return 'mind';
  return null;
}

function hasActiveLink(links, pathname) {
  return links.some(l => pathname.startsWith(l.to));
}

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { name, tagline, logo } = useAgency();
  const [upcoming, setUpcoming] = useState([]);
  const [fabOpen, setFabOpen] = useState(false);
  const [floatMenuOpen, setFloatMenuOpen] = useState(false);
  const fabRef = useRef(null);
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [openGroup, setOpenGroup] = useState(() => getGroupForPath(location.pathname) || 'ops');

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

  // Close all launchers on navigation; auto-open the active group
  useEffect(() => {
    setFloatMenuOpen(false);
    const group = getGroupForPath(location.pathname);
    if (group) setOpenGroup(group);
  }, [location.pathname]);

  function toggleGroup(group) {
    setOpenGroup(prev => prev === group ? null : group);
  }

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
      {/* Mobile top branding header — hidden on desktop */}
      <header className="mobile-header">
        {logo ? (
          <img src={logo} alt={name || 'Agency'} className="mobile-header-logo" />
        ) : (
          <span className="mobile-header-name">{name || 'MASSIV'}</span>
        )}
      </header>

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
            {/* OPERATIONS */}
            <button
              className={`sidebar-group-header${openGroup === 'ops' ? ' is-open' : ''}${hasActiveLink(OPS_LINKS, location.pathname) && openGroup !== 'ops' ? ' has-active' : ''}`}
              onClick={() => toggleGroup('ops')}
            >
              <span>Operations</span>
              <ChevronRight size={15} style={{ transform: openGroup === 'ops' ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease', flexShrink: 0 }} />
            </button>
            <div style={{ maxHeight: openGroup === 'ops' ? '400px' : '0', overflow: 'hidden', transition: 'max-height 0.25s ease' }}>
              {OPS_LINKS.map(({ to, icon: Icon, label }) => (
                <NavLink key={to} to={to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                  <div className="nav-icon"><Icon size={18} /></div>
                  {label}
                </NavLink>
              ))}
            </div>

            <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '4px 16px' }} />

            {/* DATABASE */}
            <button
              className={`sidebar-group-header${openGroup === 'db' ? ' is-open' : ''}${hasActiveLink(DB_LINKS, location.pathname) && openGroup !== 'db' ? ' has-active' : ''}`}
              onClick={() => toggleGroup('db')}
            >
              <span>Database</span>
              <ChevronRight size={15} style={{ transform: openGroup === 'db' ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease', flexShrink: 0 }} />
            </button>
            <div style={{ maxHeight: openGroup === 'db' ? '200px' : '0', overflow: 'hidden', transition: 'max-height 0.25s ease' }}>
              {DB_LINKS.map(({ to, icon: Icon, label }) => (
                <NavLink key={to} to={to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                  <div className="nav-icon"><Icon size={18} /></div>
                  {label}
                </NavLink>
              ))}
            </div>

            <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '4px 16px' }} />

            {/* THE MIND */}
            <button
              className={`sidebar-group-header${openGroup === 'mind' ? ' is-open' : ''}${hasActiveLink(MIND_LINKS, location.pathname) && openGroup !== 'mind' ? ' has-active' : ''}`}
              onClick={() => toggleGroup('mind')}
            >
              <span>The Mind</span>
              <ChevronRight size={15} style={{ transform: openGroup === 'mind' ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease', flexShrink: 0 }} />
            </button>
            <div style={{ maxHeight: openGroup === 'mind' ? '300px' : '0', overflow: 'hidden', transition: 'max-height 0.25s ease' }}>
              {MIND_LINKS.map(({ to, icon: Icon, label }) => (
                <NavLink key={to} to={to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                  <div className="nav-icon"><Icon size={18} /></div>
                  {label}
                </NavLink>
              ))}
            </div>
          </nav>

          {upcoming.length > 0 && (
            <div className="sidebar-upcoming" onClick={() => navigate('/calendar')} style={{ cursor: 'pointer' }}>
              <div className="sidebar-upcoming-title">Upcoming</div>
              {upcoming.map(ev => (
                <div key={ev.id} className="sidebar-upcoming-item">
                  <span className="sidebar-upcoming-dot" style={{ background: ev.color || '#7BA01A' }} />
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

      {/* Sticky FAB — menu button on top, + FAB below */}
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
        {/* Floating nav menu button — mobile: primary navigation; desktop: hidden */}
        <button
          className={`fab-nav-btn${floatMenuOpen ? ' active' : ''}`}
          onClick={() => { setFabOpen(false); setFloatMenuOpen(o => !o); }}
          aria-label="All pages"
        >
          <LayoutGrid size={18} />
        </button>
        <button className="fab-btn" onClick={() => { setFloatMenuOpen(false); setFabOpen(o => !o); }} aria-label="Quick actions">
          {fabOpen ? <X size={20} /> : <Plus size={20} />}
        </button>
      </div>

      {/* Float-menu full-nav launcher — all pages */}
      {floatMenuOpen && (
        <div className="more-launcher-overlay" onClick={() => setFloatMenuOpen(false)}>
          <div className="more-launcher-box" onClick={e => e.stopPropagation()}>
            <div className="more-launcher-header">
              <span className="more-launcher-title">Navigation</span>
              <button className="modal-close" onClick={() => setFloatMenuOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="more-launcher-grid">
              {ALL_NAV_PAGES.map(({ to, icon: Icon, label }) => (
                <button
                  key={to}
                  className={`more-tile${location.pathname.startsWith(to) ? ' active' : ''}`}
                  onClick={() => { navigate(to); setFloatMenuOpen(false); }}
                >
                  <div className="more-tile-icon"><Icon size={22} /></div>
                  <span className="more-tile-label">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

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
