import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    if (config.headers) delete config.headers['Content-Type'];
  }
  const token = localStorage.getItem('soul_guest_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const staff = localStorage.getItem('soul_sales_token');
  if (staff && config.url?.startsWith('/sales')) {
    config.headers.Authorization = `Bearer ${staff}`;
  }
  return config;
});

export async function validatePromoCode({ code, amount }) {
  const { data } = await api.post('/promo-codes/validate', { code, amount });
  if (!data?.valid) throw new Error(data?.error || 'Invalid promo code');
  return {
    code: data.code,
    percentage: Number(data.discount_percent || 0),
    discountAmount: Number(data.discount_amount || 0),
    discountedTotal: data.discounted_total,
  };
}

export async function createBookingCheckout(payload) {
  const { data } = await api.post('/bookings/checkout', payload);
  return data;
}

export default api;
