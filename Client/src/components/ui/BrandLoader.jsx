/**
 * Guest-only branded loading mark (Soul logo + soft motion).
 * Do not import from admin — admin keeps LoadingSpinner.
 */
export default function BrandLoader({
  fullPage = false,
  size = 'md',
  label = 'Loading',
  className = '',
}) {
  const sizes = {
    xs: { wrap: 'h-9 w-9', logo: 'h-4 w-4', ring: 'inset-0' },
    sm: { wrap: 'h-14 w-14', logo: 'h-7 w-7', ring: 'inset-0' },
    md: { wrap: 'h-24 w-24', logo: 'h-12 w-12', ring: 'inset-0' },
    lg: { wrap: 'h-32 w-32', logo: 'h-16 w-16', ring: 'inset-0' },
  };
  const s = sizes[size] || sizes.md;

  const mark = (
    <div
      className={`soul-brand-loader relative inline-flex items-center justify-center ${s.wrap} ${className}`}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <span className="soul-brand-loader__glow absolute inset-[-18%] rounded-full" aria-hidden />
      <span
        className={`soul-brand-loader__orbit absolute ${s.ring} rounded-full`}
        aria-hidden
      />
      <span
        className="soul-brand-loader__orbit soul-brand-loader__orbit--lag absolute inset-[10%] rounded-full"
        aria-hidden
      />
      <span className="soul-brand-loader__mark relative z-[1] flex items-center justify-center rounded-full bg-white/90 shadow-[0_10px_40px_rgba(40,63,94,0.12)] ring-1 ring-[var(--soul-line)] backdrop-blur-sm">
        <img
          src="/soul-brand/soul-logo.png"
          alt=""
          className={`soul-brand-loader__logo object-contain ${s.logo}`}
          width={64}
          height={64}
          decoding="async"
        />
      </span>
      <span className="sr-only">{label}</span>
    </div>
  );

  if (!fullPage) return mark;

  return (
    <div className="soul-brand-loader-page grid min-h-[50vh] place-items-center px-6 py-16">
      <div className="flex flex-col items-center gap-5">
        {mark}
        <p className="soul-brand-loader__caption font-display text-lg tracking-[0.04em] text-soul-blue/70">
          Soul Hospitality
        </p>
      </div>
    </div>
  );
}
