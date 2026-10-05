import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { brand } from '../../theme/brand';
import { useLocale } from '../../context/LocaleContext';
import { ArrowDot, useCairoTime } from '../ui/Editorial';


export default function AuthShell({
  children,
  imageSrc,
  eyebrow,
  title,
  imageAlt = 'Soul Hospitality',
  variant = 'overlay', 
}) {
  const { t } = useLocale();
  const time = useCairoTime();
  return (
    <main className="relative grid min-h-screen w-full grid-cols-1 bg-soul-paper md:grid-cols-[1.05fr_1fr]">
      <Link
        to="/"
        aria-label={t('auth.closeGoHome')}
        className="fixed end-5 top-5 z-50 flex h-11 w-11 items-center justify-center rounded-full border border-soul-line bg-white/85 text-soul-blue shadow-[0_10px_30px_rgba(40,63,94,0.12)] backdrop-blur-md transition-all duration-300 hover:rotate-90 hover:border-soul-blue hover:bg-soul-blue hover:text-white sm:end-6 sm:top-6"
      >
        <X className="h-5 w-5" strokeWidth={2} />
      </Link>

      <section className="sticky top-0 hidden h-screen w-full p-3 md:flex">
        <div className="g-grain relative isolate h-full w-full overflow-hidden rounded-[32px] bg-soul-ink">
          <img
            src={imageSrc}
            alt={imageAlt}
            className="g-kenburns absolute inset-0 h-full w-full select-none object-cover"
          />
          <div
            className={`absolute inset-0 ${
              variant === 'badge'
                ? 'bg-gradient-to-t from-soul-blue/30 via-soul-blue/10 to-transparent'
                : 'bg-gradient-to-t from-soul-ink/85 via-soul-blue-dark/30 to-soul-ink/20'
            }`}
          />

          <div className="absolute inset-x-8 top-8 z-10 flex items-center justify-between text-white/80 lg:inset-x-10">
            <Link to="/" className="flex items-center gap-2.5">
              <img
                src="/soul-brand/soul-logo.png"
                alt=""
                className="h-7 w-auto brightness-0 invert"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
              <span className="font-display text-xl font-semibold text-white">Soul</span>
            </Link>
            <span className="g-index">Cairo · {time}</span>
          </div>

          {variant === 'badge' ? (
            <div className="absolute bottom-8 start-8 z-10 max-w-sm rounded-[24px] border border-white/40 bg-white/85 px-6 py-5 shadow-[0_18px_50px_rgba(40,63,94,0.16)] backdrop-blur-md">
              <p className="g-index text-soul-blue/70">{brand.name}</p>
              <p className="g-display mt-2 text-3xl text-soul-blue">{title}</p>
            </div>
          ) : (
            <div className="relative z-10 flex h-full w-full items-end px-8 pb-10 lg:px-10 lg:pb-12">
              <div className="max-w-xl animate-[fadeUp_0.7s_ease-out]">
                <div className="mb-5 flex items-center gap-3 text-white/75">
                  <span className="g-dot" />
                  <span className="g-index">{eyebrow}</span>
                </div>
                <h2 className="g-display text-[clamp(44px,4.6vw,76px)] text-white">{title}</h2>
                <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/70">{brand.tagline}</p>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="relative flex h-full min-h-screen w-full flex-col justify-center px-6 py-20 sm:px-14 lg:px-24">
        <div className="mx-auto w-full max-w-md animate-[fadeUp_0.55s_ease-out]">
          <Link to="/" className="mb-10 flex items-center gap-2.5 md:hidden">
            <img
              src="/soul-brand/soul-logo.png"
              alt=""
              className="h-8 w-auto"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
            <span className="font-display text-xl font-semibold text-soul-blue">Soul</span>
          </Link>
          {children}
        </div>
      </section>

      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </main>
  );
}

export function AuthField({
  label,
  icon: Icon,
  type = 'text',
  value,
  onChange,
  placeholder,
  autoComplete,
  required = true,
  rightSlot,
  name,
}) {
  return (
    <label className="block">
      <span className="g-index mb-2.5 block text-soul-muted">{label}</span>
      <div className="relative">
        {Icon ? (
          <span className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-soul-muted/70">
            <Icon className="h-4 w-4" strokeWidth={1.75} />
          </span>
        ) : null}
        <input
          name={name}
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          className={`w-full rounded-2xl border border-soul-line bg-white py-4 text-[15px] text-soul-blue placeholder:text-soul-muted/45 outline-none transition-all focus:border-soul-blue focus:ring-4 focus:ring-soul-blue/5 ${
            Icon ? 'ps-12' : 'ps-4'
          } ${rightSlot ? 'pe-12' : 'pe-4'}`}
        />
        {rightSlot ? (
          <div className="absolute end-4 top-1/2 -translate-y-1/2">{rightSlot}</div>
        ) : null}
      </div>
    </label>
  );
}

export function AuthError({ message }) {
  if (!message) return null;
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {message}
    </div>
  );
}

export function AuthSubmit({ loading, children, loadingLabel, disabled }) {
  const { t } = useLocale();
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      className="g-btn g-btn-primary mt-2 w-full !justify-between !py-4 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? loadingLabel || t('auth.pleaseWait') : children}
      <ArrowDot />
    </button>
  );
}
