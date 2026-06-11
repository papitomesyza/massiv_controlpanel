import React, { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, FolderKanban, Users, UserCog, Package, BarChart3, FileText, Settings, LogOut, CalendarDays, MapPin } from 'lucide-react';
import { useAgency } from '../context/AgencyContext';
import { api } from '../api';

const links = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/projects',  icon: FolderKanban,   label: 'Projects'  },
  { to: '/calendar',  icon: CalendarDays,    label: 'Calendar'  },
  { to: '/map',       icon: MapPin,          label: 'Map'       },
  { to: '/clients',   icon: Users,           label: 'Clients'   },
  { to: '/crew',      icon: UserCog,         label: 'Crew'      },
  { to: '/assets',    icon: Package,         label: 'Assets'    },
  { to: '/finances',  icon: BarChart3,       label: 'Finances'  },
  { to: '/budgets',   icon: FileText,        label: 'Investment Estimations' },
  { to: '/settings',  icon: Settings,        label: 'Settings'  },
];

function fmtShortDate(d) {
  if (!d) return '';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export default function Layout() {
  const navigate = useNavigate();
  const { name, tagline, logo } = useAgency();
  const [upcoming, setUpcoming] = useState([]);

  useEffect(() => {
    api.get('/calendar/upcoming?limit=3').then(setUpcoming).catch(() => {});
  }, []);

  function logout() {
    localStorage.removeItem('massiv_auth');
    navigate('/login');
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

        <nav className="sidebar-nav">
          {links.map(({ to, icon: Icon, label }) => (
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
                <span
                  className="sidebar-upcoming-dot"
                  style={{ background: ev.color || '#723CEB' }}
                />
                <div className="sidebar-upcoming-info">
                  <span className="sidebar-upcoming-name">{ev.title.length > 22 ? ev.title.slice(0, 22) + '…' : ev.title}</span>
                  <span className="sidebar-upcoming-date">{fmtShortDate(ev.start_date)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="sidebar-footer">
          <div className="built-by">built by year28</div>
          <button className="logout-btn" onClick={logout}>
            <div className="nav-icon"><LogOut size={18} /></div>
            Logout
          </button>
        </div>
      </aside>

      <div className="main-content">
        <div className="page-inner">
          <Outlet />
        </div>
        <footer className="page-footer">built by year28</footer>
      </div>

      <nav className="bottom-nav">
        <div className="bottom-nav-inner">
          {links.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
              <Icon size={20} />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
