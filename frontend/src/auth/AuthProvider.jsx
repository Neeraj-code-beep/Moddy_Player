import { useEffect, useMemo, useState } from 'react';
import { refreshAuth } from '../api/api';
import AuthContext from './AuthContext';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    let active = true;
    const onExpired = () => { if (active) { setUser(null); setSessionExpired(true); } };
    const onRestored = (event) => { if (active) { setUser(event.detail || null); setSessionExpired(false); } };
    window.addEventListener('moddy:auth-expired', onExpired);
    window.addEventListener('moddy:auth-restored', onRestored);
    refreshAuth().then((account) => { if (active) setUser(account); }).catch(() => {}).finally(() => { if (active) setLoading(false); });
    return () => { active = false; window.removeEventListener('moddy:auth-expired', onExpired); window.removeEventListener('moddy:auth-restored', onRestored); };
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
    sessionExpired,
    setUser(account) { setUser(account); if (account) setSessionExpired(false); },
    clearSessionNotice() { setSessionExpired(false); },
  }), [user, loading, sessionExpired]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
