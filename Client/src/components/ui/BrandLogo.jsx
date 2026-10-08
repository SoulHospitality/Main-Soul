import { brand } from '../../theme/brand';

/**
 * Soul Hospitality lockup: the "sh." signature icon with the SOUL HOSPITALITY wordmark.
 * layout="inline" sits the wordmark beside the icon; "stacked" follows the main logo (SOUL over HOSPITALITY).
 */
export default function BrandLogo({
  layout = 'inline',
  inverted = false,
  showText = true,
  iconClassName = 'h-10 w-auto',
  textClassName = '',
  className = '',
}) {
  const ink = inverted ? 'text-white' : 'text-soul-blue';
  return (
    <span className={`inline-flex items-center gap-2.5 ${layout === 'stacked' ? 'flex-col items-start gap-3' : ''} ${className}`}>
      <img
        src="/soul-brand/soul-logo.png"
        alt={showText ? '' : brand.name}
        className={`${iconClassName} object-contain transition duration-500 ${inverted ? 'brightness-0 invert' : ''}`}
        onError={(e) => {
          e.currentTarget.style.display = 'none';
        }}
      />
      {showText ? (
        layout === 'stacked' ? (
          <span className={`flex flex-col font-bold uppercase leading-[0.86] ${ink} ${textClassName}`} dir="ltr">
            <span className="text-[2.1em] tracking-[-0.045em]">Soul</span>
            <span className="text-[1em] tracking-[-0.01em]">Hospitality</span>
          </span>
        ) : (
          <span
            className={`whitespace-nowrap text-[15px] font-bold uppercase leading-none tracking-[-0.02em] transition-colors duration-500 ${ink} ${textClassName}`}
            dir="ltr"
          >
            Soul Hospitality
          </span>
        )
      ) : null}
    </span>
  );
}
