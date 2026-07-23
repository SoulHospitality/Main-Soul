import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { brand } from '../../theme/brand';
import { useLocale } from '../../context/LocaleContext';

/**
 * SoulHospitality-style split auth shell, restyled with soul-website palette.
 */
export default function AuthShell({
  children,
  imageSrc,
  eyebrow,
  title,
  imageAlt = 'Soul Hospitality',
  variant = 'overlay', // 'overlay' | 'badge'
}) {
  const { t } = useLocale();
  return (
    <main className="relative grid min-h-screen w-full grid-cols-1 bg-white md:grid-cols-2">
      <Link
        to="/"
        aria-label={t('auth.closeGoHome')}
        className="fixed right-5 top-5 z-50 flex h-11 w-11 items-center justify-center rounded-full border border-soul-line bg-white text-soul-blue shadow-[0_10px_30px_rgba(40,63,94,0.12)] transition-all duration-300 hover:-translate-y-0.5 hover:border-soul-blue hover:bg-soul-blue hover:text-white sm:right-6 sm:top-6"
      >
        <X className="h-5 w-5" strokeWidth={2.25} />
      </Link>

      <section className="relative hidden h-screen w-full overflow-hidden bg-soul-ink md:flex">
        <img
          src={imageSrc}
          alt={imageAlt}
          className="absolute inset-0 h-full w-full select-none object-cover"
        />
        <div
          className={`absolute inset-0 ${
            variant === 'badge'
              ? 'bg-gradient-to-t from-soul-blue/25 via-soul-blue/10 to-transparent'
              : 'bg-gradient-to-t from-soul-ink/75 via-soul-blue-dark/35 to-transparent'
          }`}
        />

        {variant === 'badge' ? (
          <div className="absolute bottom-8 left-8 z-10 max-w-sm rounded-3xl border border-white/40 bg-white/85 px-6 py-5 shadow-[0_18px_50px_rgba(40,63,94,0.16)] backdrop-blur-md">
            <p className="soul-eyebrow text-soul-blue/70">{brand.name}</p>
            <p className="mt-2 font-display text-2xl font-semibold text-soul-blue">{title}</p>
          </div>
        ) : (
          <div className="relative z-10 flex h-full w-full items-end px-10 pb-12 lg:px-14 lg:pb-14">
            <div className="max-w-xl animate-[fadeUp_0.7s_ease-out]">
              <p className="mb-4 soul-eyebrow text-white/75">{eyebrow}</p>
              <h2 className="font-display text-4xl font-semibold leading-tight text-white lg:text-5xl">
                {title}
              </h2>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-white/70">
                {brand.tagline}
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="relative flex h-full min-h-screen w-full flex-col justify-center bg-[linear-gradient(180deg,#ffffff_0%,#f8f6f2_100%)] px-8 py-16 sm:px-16 lg:px-24">
        <div className="mx-auto w-full max-w-md animate-[fadeUp_0.55s_ease-out]">
          <Link to="/" className="mb-8 flex items-center gap-2.5 md:hidden">
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
      <span className="mb-2 block text-sm font-semibold text-soul-blue/80">{label}</span>
      <div className="relative">
        {Icon ? (
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-soul-muted/70">
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
          className={`w-full rounded-full border border-soul-line bg-white py-3.5 text-sm text-soul-blue placeholder:text-soul-muted/45 outline-none transition-all focus:border-soul-blue focus:ring-2 focus:ring-soul-blue/10 ${
            Icon ? 'pl-12' : 'pl-4'
          } ${rightSlot ? 'pr-12' : 'pr-4'}`}
        />
        {rightSlot ? (
          <div className="absolute right-4 top-1/2 -translate-y-1/2">{rightSlot}</div>
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
      className="mt-2 w-full rounded-full bg-soul-blue py-3.5 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(40,63,94,0.22)] transition-all duration-300 hover:bg-soul-blue-dark hover:shadow-[0_16px_36px_rgba(40,63,94,0.28)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? loadingLabel || t('auth.pleaseWait') : children}
    </button>
  );
}
