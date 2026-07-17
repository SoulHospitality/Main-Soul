import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../api/axios';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pms_user')); } catch { return null; }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('pms_token');
    if (token) {
      api.get('/auth/me')
        .then(res => { setUser(res.data); localStorage.setItem('pms_user', JSON.stringify(res.data)); })
        .catch(() => { localStorage.removeItem('pms_token'); localStorage.removeItem('pms_user'); setUser(null); })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (username, password) => {
    const res = await api.post('/auth/login', { username, password });
    const userPayload = {
      ...res.data.user,
      is_first_login: Boolean(res.data.user?.is_first_login || res.data.forcePasswordChange),
    };
    localStorage.setItem('pms_token', res.data.token);
    localStorage.setItem('pms_user', JSON.stringify(userPayload));
    setUser(userPayload);
    return userPayload;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('pms_token');
    localStorage.removeItem('pms_user');
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const res = await api.get('/auth/me');
    const next = { ...res.data, is_first_login: Boolean(res.data?.is_first_login) };
    setUser(next);
    localStorage.setItem('pms_user', JSON.stringify(next));
    return next;
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
