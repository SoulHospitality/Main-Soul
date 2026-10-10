import api from '../api/axios';

const base = (path) => `/inbox${path.startsWith('/') ? path : `/${path}`}`;

export const inboxApi = {
  get: (path, params) => api.get(base(path), { params }).then((r) => r.data),
  post: (path, body) => api.post(base(path), body ?? {}).then((r) => r.data),
  patch: (path, body) => api.patch(base(path), body ?? {}).then((r) => r.data),
  put: (path, body) => api.put(base(path), body ?? {}).then((r) => r.data),
  upload: (path, formData) => api.post(base(path), formData).then((r) => r.data),
  blob: (path) => api.get(base(path), { responseType: 'blob' }).then((r) => r.data),
};

export function errorMessage(err, fallback = 'Something went wrong') {
  return err?.response?.data?.error || err?.message || fallback;
}

export function errorCode(err) {
  return err?.response?.data?.code || null;
}
