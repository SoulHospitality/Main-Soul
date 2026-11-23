import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Star } from 'lucide-react';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import api from '../api/http';
import { useLocale } from '../context/LocaleContext';

const TEXT = {
  en: {
    eyebrow: 'Your stay',
    title: (name) => `How was your stay${name ? `, ${name}` : ''}?`,
    sub: (unit) => `Rate your stay at ${unit} out of 5.`,
    comment: 'Anything you’d like to tell us? (optional)',
    submit: 'Send rating',
    sending: 'Sending…',
    thanks: 'Thank you for your rating!',
    thanksLow: 'Thank you. We’re sorry it wasn’t perfect: our team will look into it.',
    google: 'Would you share it on Google too? It helps other guests find us.',
    googleBtn: 'Review us on Google',
    invalid: 'This link is not valid or has expired.',
    home: 'Back to the home page',
    choose: 'Choose 1 to 5 stars',
  },
  ar: {
    eyebrow: 'إقامتك',
    title: (name) => `إيه رأيك في إقامتك${name ? ` يا ${name}` : ''}؟`,
    sub: (unit) => `قيّم إقامتك في ${unit} من 5.`,
    comment: 'حابب تقولنا حاجة؟ (اختياري)',
    submit: 'إرسال التقييم',
    sending: 'جاري الإرسال…',
    thanks: 'شكرًا على تقييمك!',
    thanksLow: 'شكرًا ليك. آسفين إن التجربة ماكانتش مثالية، وفريقنا هيتابع الموضوع.',
    google: 'ممكن تشاركه على جوجل كمان؟ بيساعد ضيوف تانيين يعرفونا.',
    googleBtn: 'قيّمنا على جوجل',
    invalid: 'الرابط ده مش صالح أو انتهت صلاحيته.',
    home: 'الرجوع للصفحة الرئيسية',
    choose: 'اختار من 1 لـ 5 نجوم',
  },
};

export default function RatePage() {
  const { token } = useParams();
  const { locale } = useLocale();
  const tr = TEXT[locale === 'ar' ? 'ar' : 'en'];
  const [info, setInfo] = useState(null);
  const [state, setState] = useState('loading');
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get(`/reviews/${token}`)
      .then((r) => {
        setInfo(r.data);
        setState(r.data.rated ? 'done' : 'form');
      })
      .catch(() => setState('invalid'));
  }, [token]);

  async function submit(e) {
    e.preventDefault();
    if (!rating) return setError(tr.choose);
    setState('sending');
    setError('');
    try {
      const { data } = await api.post(`/reviews/${token}`, { rating, comment });
      setInfo(data);
      setState('done');
    } catch (err) {
      if (err?.response?.status === 409) {
        setInfo((prev) => ({ ...prev, ...err.response.data }));
        setState('done');
      } else {
        setError(err?.response?.data?.error || 'Error');
        setState('form');
      }
    }
  }

  const shown = hover || rating;

  return (
    <div className="bg-soul-paper">
      <Header />
      <main className="g-shell flex min-h-[70vh] items-center justify-center py-28">
        <div className="w-full max-w-lg rounded-[28px] border border-soul-line bg-white p-8 text-center text-soul-blue shadow-sm">
          {state === 'loading' ? <p className="text-soul-muted">…</p> : null}
          {state === 'invalid' ? (
            <>
              <p>{tr.invalid}</p>
              <Link to="/" className="mt-6 inline-block underline">{tr.home}</Link>
            </>
          ) : null}
          {(state === 'form' || state === 'sending') && info ? (
            <form onSubmit={submit}>
              <span className="g-index text-soul-muted">{tr.eyebrow}</span>
              <h1 className="g-display mt-2 text-[clamp(28px,4vw,40px)]">{tr.title(info.guest_first_name)}</h1>
              <p className="mt-2 text-soul-muted">{tr.sub(info.unit_title)}</p>
              <div className="mt-6 flex justify-center gap-2" dir="ltr" onMouseLeave={() => setHover(0)}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-label={`${n} / 5`}
                    onMouseEnter={() => setHover(n)}
                    onClick={() => setRating(n)}
                    className="p-1 transition-transform hover:scale-110"
                  >
                    <Star className={`h-10 w-10 ${n <= shown ? 'fill-amber-400 text-amber-400' : 'text-soul-line'}`} />
                  </button>
                ))}
              </div>
              <textarea
                dir="auto"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={tr.comment}
                rows={3}
                maxLength={2000}
                className="mt-6 w-full rounded-2xl border border-soul-line bg-soul-paper p-3 text-sm outline-none focus:border-soul-blue/50"
              />
              {error ? <p className="mt-2 text-sm text-rose-600">{error}</p> : null}
              <button type="submit" disabled={state === 'sending'} className="mt-5 rounded-full bg-soul-blue px-7 py-3 text-sm font-semibold text-white disabled:opacity-60">
                {state === 'sending' ? tr.sending : tr.submit}
              </button>
            </form>
          ) : null}
          {state === 'done' && info ? (
            <>
              <div className="flex justify-center gap-1" dir="ltr">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star key={n} className={`h-8 w-8 ${n <= (info.rating || 0) ? 'fill-amber-400 text-amber-400' : 'text-soul-line'}`} />
                ))}
              </div>
              <h1 className="g-display mt-4 text-[clamp(26px,3.6vw,36px)]">{(info.rating || 5) <= 3 ? tr.thanksLow : tr.thanks}</h1>
              {info.google_review_url ? (
                <>
                  <p className="mt-4 text-soul-muted">{tr.google}</p>
                  <a href={info.google_review_url} target="_blank" rel="noopener noreferrer" className="mt-5 inline-block rounded-full bg-soul-blue px-7 py-3 text-sm font-semibold text-white">
                    {tr.googleBtn}
                  </a>
                </>
              ) : null}
              <div className="mt-6">
                <Link to="/" className="text-sm underline">{tr.home}</Link>
              </div>
            </>
          ) : null}
        </div>
      </main>
      <Footer />
    </div>
  );
}
