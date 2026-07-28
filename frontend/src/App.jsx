import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import Clients from './pages/Clients';
import ClientDetail from './pages/ClientDetail';
import Crew from './pages/Crew';
import CrewDetail from './pages/CrewDetail';
import Finances from './pages/Finances';
import Budgets from './pages/Budgets';
import Assets from './pages/Assets';
import Settings from './pages/Settings';
import Calendar from './pages/Calendar';
import Map from './pages/Map';
import Invoices from './pages/Invoices';
import PublicExpense from './pages/PublicExpense';
import PublicCollection from './pages/PublicCollection';
import PublicMind from './pages/PublicMind';
import Collections from './pages/Collections';
import CollectionDetail from './pages/CollectionDetail';
import MindAccounts from './pages/MindAccounts';
import Pitches from './pages/Pitches';
import PitchEditor from './pages/PitchEditor';
import { AgencyProvider } from './context/AgencyContext';

function applyFavicon() {
  const favicon = localStorage.getItem('massiv_favicon');
  let link = document.querySelector("link[rel~='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  if (favicon) {
    link.href = favicon;
  } else {
    link.href = '/favicon.ico';
  }
}

function applyTitle() {
  const name = localStorage.getItem('massiv_agency_name') || 'MASSIV TV';
  document.title = name;
}

function PrivateRoute({ children }) {
  return localStorage.getItem('massiv_auth') ? children : <Navigate to="/login" replace />;
}

export default function App() {
  useEffect(() => {
    applyFavicon();
    applyTitle();

    function onNameUpdated() { applyTitle(); }
    function onFaviconUpdated() { applyFavicon(); }

    window.addEventListener('agencyNameUpdated', onNameUpdated);
    window.addEventListener('faviconUpdated', onFaviconUpdated);
    return () => {
      window.removeEventListener('agencyNameUpdated', onNameUpdated);
      window.removeEventListener('faviconUpdated', onFaviconUpdated);
    };
  }, []);

  return (
    <AgencyProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/expense/:token" element={<PublicExpense />} />
        <Route path="/shared/collection/:token" element={<PublicCollection />} />
        <Route path="/shared/mind/:token" element={<PublicMind />} />
        <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="projects" element={<Projects />} />
          <Route path="projects/:id" element={<ProjectDetail />} />
          <Route path="clients" element={<Clients />} />
          <Route path="clients/:id" element={<ClientDetail />} />
          <Route path="crew" element={<Crew />} />
          <Route path="crew/:id" element={<CrewDetail />} />
          <Route path="finances" element={<Finances />} />
          <Route path="budgets" element={<Budgets />} />
          <Route path="assets" element={<Assets />} />
          <Route path="settings" element={<Settings />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="map" element={<Map />} />
          <Route path="invoices" element={<Invoices />} />
          <Route path="collections" element={<Collections />} />
          <Route path="collections/:id" element={<CollectionDetail />} />
          <Route path="accounts" element={<MindAccounts />} />
          <Route path="pitches" element={<Pitches />} />
          <Route path="pitches/:id" element={<PitchEditor />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AgencyProvider>
  );
}
