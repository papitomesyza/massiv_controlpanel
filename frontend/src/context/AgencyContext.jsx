import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../api';

const AgencyContext = createContext({ name: 'MASSIV TV', tagline: '', logo: null });

export function AgencyProvider({ children }) {
  const [name, setName] = useState(() => localStorage.getItem('massiv_agency_name') || 'MASSIV TV');
  const [tagline, setTagline] = useState(() => localStorage.getItem('massiv_agency_tagline') || '');
  const [logo, setLogo] = useState(() => localStorage.getItem('massiv_logo'));

  useEffect(() => {
    // Fetch from API if authenticated, to ensure DB values are reflected
    const auth = localStorage.getItem('massiv_auth');
    if (auth) {
      api.get('/settings/agency').then(data => {
        if (data.agency_name) {
          setName(data.agency_name);
          localStorage.setItem('massiv_agency_name', data.agency_name);
        }
        if (data.agency_tagline !== undefined && data.agency_tagline !== null) {
          setTagline(data.agency_tagline);
          localStorage.setItem('massiv_agency_tagline', data.agency_tagline);
        }
        if (data.agency_logo_base64) {
          setLogo(data.agency_logo_base64);
          localStorage.setItem('massiv_logo', data.agency_logo_base64);
        }
        // Dispatch so document.title and favicon also update
        window.dispatchEvent(new Event('agencyNameUpdated'));
        if (data.agency_logo_base64) window.dispatchEvent(new Event('logoUpdated'));
      }).catch(() => {});
    }

    function handleLogoUpdated() {
      setLogo(localStorage.getItem('massiv_logo'));
    }
    function handleNameUpdated() {
      setName(localStorage.getItem('massiv_agency_name') || 'MASSIV TV');
      setTagline(localStorage.getItem('massiv_agency_tagline') || '');
    }

    window.addEventListener('logoUpdated', handleLogoUpdated);
    window.addEventListener('agencyNameUpdated', handleNameUpdated);
    return () => {
      window.removeEventListener('logoUpdated', handleLogoUpdated);
      window.removeEventListener('agencyNameUpdated', handleNameUpdated);
    };
  }, []);

  return (
    <AgencyContext.Provider value={{ name, tagline, logo }}>
      {children}
    </AgencyContext.Provider>
  );
}

export function useAgency() {
  return useContext(AgencyContext);
}
