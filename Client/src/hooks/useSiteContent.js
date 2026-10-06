import { useQuery } from '@tanstack/react-query';
import api from '../api/http';
import { useLocale } from '../context/LocaleContext';

export const SITE_CONTENT_KEY = ['guest-site-content'];

/** Website-control overrides for the guest site; empty fields fall back to the built-in copy. */
export function useSiteContent() {
  const { locale } = useLocale();
  const { data } = useQuery({
    queryKey: SITE_CONTENT_KEY,
    queryFn: () => api.get('/site-content').then((r) => r.data || {}),
    staleTime: 5 * 60_000,
  });
  const content = data || {};
  const pick = (obj, base) => {
    const value = obj?.[`${base}_${locale}`] || obj?.[`${base}_en`];
    return value ? String(value) : '';
  };
  const sectionOn = (name) => content.sections?.[name] !== false;
  return { content, pick, sectionOn, loaded: Boolean(data) };
}
