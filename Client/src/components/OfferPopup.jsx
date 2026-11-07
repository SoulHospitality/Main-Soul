import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import api from '../api/http';
import { useLocale } from '../context/LocaleContext';

const SEEN_KEY = 'soul_offers_seen';

function seen() {
  try {
    return JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]');
  } catch {
    return [];
  }
}
function markSeen(id) {
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...seen(), id])]));
  } catch {
    /* private mode */
  }
}

/** Which offers to ask for on this page: the unit being viewed, the place searched, or site-wide ones. */
function offerParams(pathname, params) {
  const listing = pathname.match(/^\/listings\/([^/]+)/);
  if (listing) return { unit: decodeURIComponent(listing[1]) };
  if (pathname.startsWith('/search')) {
    const destination = params.get('destination') || params.get('area') || '';
    const project = params.get('project') || params.get('compound') || '';
    return destination || project ? { destination, project } : {};
  }
  if (/^\/(admin|sales|checkout|sign-in|sign-up|receipt)/.test(pathname)) return null;
  return {};
}

/** Offer popup: once per offer per visit, only where the offer applies. */
export default function OfferPopup() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const { isRtl } = useLocale();
  const [offer, setOffer] = useState(null);
  const query = offerParams(pathname, params);
  const key = JSON.stringify(query);

  useEffect(() => {
    if (!query) {
      setOffer(null);
      return undefined;
    }
    let cancelled = false;
    // Let the page (and the entry popup) settle first.
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get('/offers', { params: query });
        if (cancelled) return;
        const done = seen();
        const next = (data?.items || []).find((o) => o.show_popup && !done.includes(o.id));
        setOffer(next || null);
      } catch {
        if (!cancelled) setOffer(null);
      }
    }, 2500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!offer || typeof document === 'undefined') return null;
  const close = () => {
    markSeen(offer.id);
    setOffer(null);
  };
  const name = (isRtl && offer.name_ar) || offer.name;
  const text = (isRtl && offer.description_ar) || offer.description;
  const percent = Number(offer.discount_percent);
  const until = offer.ends_on
    ? new Date(`${offer.ends_on}T12:00:00`).toLocaleDateString(isRtl ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'long' })
    : null;

  return createPortal(
    <div className="fixed inset-0 z-[225] flex items-end justify-center bg-slate-950/55 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={name} onClick={close}>
      <div dir={isRtl ? 'rtl' : 'ltr'} className="relative w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={close} className="absolute end-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full bg-white/90 text-slate-900 shadow hover:bg-white" aria-label={isRtl ? 'إغلاق' : 'Close'}>
          <X className="h-4 w-4" strokeWidth={2.5} />
        </button>
        {offer.image_url ? <img src={offer.image_url} alt="" className="h-48 w-full object-cover" /> : null}
        <div className="p-6 text-center">
          <p className="font-display text-5xl font-semibold tracking-tight text-[#0b4f73]">
            {isRtl ? `خصم ${percent}%` : `${percent}% off`}
          </p>
          <h2 className="mt-2 text-xl font-semibold text-slate-900">{name}</h2>
          {text ? <p className="mt-2 text-sm leading-relaxed text-slate-600">{text}</p> : null}
          {until ? (
            <p className="mt-3 text-xs font-medium text-slate-500">{isRtl ? `ساري حتى ${until}` : `Until ${until}`}</p>
          ) : null}
          <button type="button" onClick={close} className="mt-5 w-full rounded-full bg-[#0b4f73] px-5 py-3 text-sm font-semibold text-white hover:bg-[#093f5c]">
            {isRtl ? 'تمام، شكراً' : 'Got it'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
