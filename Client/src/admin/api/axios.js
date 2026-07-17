import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('pms_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;

  let url = config.url || '';
  if (url.startsWith('/auth/')) {
    config.url = url.replace(/^\/auth\//, '/staff/auth/');
  } else if (
    !url.startsWith('/staff/') &&
    !url.startsWith('/pms/') &&
    !url.startsWith('/recruitment/')
  ) {
    config.url = `/pms${url.startsWith('/') ? url : `/${url}`}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => {
    // /staff/auth/me returns { user }; normalize for AuthContext
    if (res.config.url?.includes('/staff/auth/me') && res.data?.user) {
      res.data = res.data.user;
    }
    return res;
  },
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('pms_token');
      localStorage.removeItem('pms_user');
      if (!window.location.pathname.includes('/sign-in')) {
        window.location.href = '/sign-in';
      }
    }
    if (err.response?.status === 423 && !window.location.pathname.includes('/change-password')) {
      window.location.href = '/admin/change-password';
    }
    return Promise.reject(err);
  }
);

export default api;
