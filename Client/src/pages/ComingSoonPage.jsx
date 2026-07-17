import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { brand, whatsappHref } from '../theme/brand';

const HERO = '/soul-brand/coast-hero-2.jpg';

/** Temporary public landing — real site remains at /home */
export default function ComingSoonPage() {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const bookHref = whatsappHref("Hi Soul — I'd like to book a stay.");

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-soul-ink text-white">
      <div className="absolute inset-0">
        <img
          src={HERO}
          alt=""
          className="coming-soon-hero h-full w-full object-cover"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(165deg, rgba(2,6,23,0.72) 0%, rgba(22,35,58,0.55) 42%, rgba(2,6,23,0.82) 100%)',
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              'radial-gradient(ellipse 80% 50% at 50% 100%, rgba(40,63,94,0.45), transparent 70%)',
          }}
        />
      </div>

      <div className="relative z-10 flex min-h-[100dvh] flex-col">
        <header
          className={`flex items-center justify-between px-6 pt-8 sm:px-10 sm:pt-10 transition-all duration-1000 ${
            entered ? 'translate-y-0 opacity-100' : '-translate-y-3 opacity-0'
          }`}
        >
          <span className="w-24 sm:w-28" aria-hidden="true" />
          <img
            src="/soul-brand/soul-logo.png"
            alt={brand.name}
            className="h-14 w-auto object-contain brightness-0 invert sm:h-16"
          />
          <Link
            to="/sign-in?staff=1"
            className="w-24 sm:w-28 text-right text-[11px] font-medium uppercase tracking-[0.18em] text-white/45 transition hover:text-white/85"
          >
            Staff login
          </Link>
        </header>

        <main className="flex flex-1 flex-col items-center justify-center px-6 pb-28 text-center sm:px-8">
          <p
            className={`soul-eyebrow mb-5 text-white/55 transition-all delay-150 duration-1000 ${
              entered ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
            }`}
          >
            Coming soon
          </p>

          <h1
            className={`font-display max-w-3xl text-[clamp(2.75rem,8vw,5.5rem)] font-medium leading-[1.05] tracking-wide text-white transition-all delay-300 duration-1000 ${
              entered ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
            }`}
          >
            We&apos;re preparing something big
          </h1>

          <p
            className={`mt-6 max-w-lg text-base leading-relaxed text-white/70 sm:text-lg transition-all delay-500 duration-1000 ${
              entered ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
            }`}
          >
            A new Soul Hospitality experience is on the way. In the meantime, book your stay
            directly with our team on WhatsApp.
          </p>

          <div
            className={`mt-10 flex flex-col items-center gap-4 transition-all delay-700 duration-1000 ${
              entered ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
            }`}
          >
            <a
              href={bookHref}
              target="_blank"
              rel="noopener noreferrer"
              className="coming-soon-wa group inline-flex items-center gap-3 rounded-full bg-[#25d366] px-8 py-4 text-sm font-semibold tracking-wide text-white shadow-[0_12px_40px_-8px_rgba(37,211,102,0.55)] transition hover:bg-[#1ebe5a]"
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="transition-transform group-hover:scale-110"
                aria-hidden="true"
              >
                <path d="M20.52 3.48A11.94 11.94 0 0012.04 0C5.5 0 .18 5.32.18 11.86c0 2.09.55 4.13 1.6 5.93L0 24l6.36-1.66a11.86 11.86 0 005.68 1.45h.01c6.54 0 11.86-5.32 11.86-11.86 0-3.17-1.23-6.15-3.39-8.45zM12.05 21.79h-.01a9.86 9.86 0 01-5.03-1.38l-.36-.21-3.77.99 1.01-3.68-.24-.38a9.84 9.84 0 01-1.51-5.26c0-5.44 4.43-9.87 9.88-9.87 2.64 0 5.12 1.03 6.98 2.9a9.81 9.81 0 012.89 6.98c0 5.44-4.43 9.87-9.84 9.87zm5.41-7.39c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.34.22-.64.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.76-1.66-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.34.45-.51.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.5l-.57-.01a1.1 1.1 0 00-.79.37c-.27.3-1.04 1.01-1.04 2.47s1.07 2.87 1.21 3.07c.15.2 2.1 3.21 5.08 4.5.71.31 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2-1.42.25-.7.25-1.29.17-1.42-.07-.13-.27-.2-.57-.35z" />
              </svg>
              Book via WhatsApp
            </a>
          </div>
        </main>

        <footer
          className={`pb-8 text-center text-[10px] uppercase tracking-[0.2em] text-white/40 transition-opacity delay-1000 duration-1000 ${
            entered ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {brand.copyright}
        </footer>
      </div>
    </div>
  );
}
