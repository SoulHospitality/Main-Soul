import { useCurrency } from '../../context/CurrencyContext';
import { whatsappHref } from '../../theme/brand';
import { getDisplayPriceEgp } from '../../utils/displayPrice';

/**
 * Sticky inquire card for for-sale listings (no nightly booking).
 */
export default function ListingSaleCard({ unit }) {
  const { formatPrice } = useCurrency();
  const amount = getDisplayPriceEgp(unit);
  const price = amount != null ? formatPrice(amount, { perNight: false }) : null;
  const sizeM2 = Number(unit?.size_m2 || unit?.unit_area || 0);
  const message = `Hi Soul — I'm interested in ${unit?.title || 'this property'} for sale${unit?.slug ? ` (${unit.slug})` : ''}.`;

  return (
    <div className="sticky top-[108px] rounded-[22px] border border-soul-line bg-white p-5 shadow-[0_18px_50px_-28px_rgba(40,63,94,0.35)]">
      <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.16em] text-soul-muted">For sale</p>
      <div className="mb-4 flex flex-wrap items-baseline gap-2">
        {price ? (
          <span className="font-num text-[28px] font-semibold leading-none text-soul-blue">{price}</span>
        ) : (
          <span className="text-lg font-semibold text-soul-blue">Inquire for price</span>
        )}
      </div>

      <dl className="mb-5 space-y-2 text-sm">
        {(unit?.beds ?? 0) > 0 && (
          <div className="flex justify-between gap-3">
            <dt className="text-soul-muted">Bedrooms</dt>
            <dd className="font-semibold text-soul-blue">{unit.beds}</dd>
          </div>
        )}
        {(unit?.baths ?? 0) > 0 && (
          <div className="flex justify-between gap-3">
            <dt className="text-soul-muted">Baths</dt>
            <dd className="font-semibold text-soul-blue">{unit.baths}</dd>
          </div>
        )}
        {sizeM2 > 0 && (
          <div className="flex justify-between gap-3">
            <dt className="text-soul-muted">Area</dt>
            <dd className="font-semibold text-soul-blue">{sizeM2} m²</dd>
          </div>
        )}
        {unit?.property_type && (
          <div className="flex justify-between gap-3">
            <dt className="text-soul-muted">Type</dt>
            <dd className="font-semibold text-soul-blue">{unit.property_type}</dd>
          </div>
        )}
        {unit?.compound && (
          <div className="flex justify-between gap-3">
            <dt className="text-soul-muted">Compound</dt>
            <dd className="font-semibold text-soul-blue text-end">{unit.compound}</dd>
          </div>
        )}
      </dl>

      <a
        href={whatsappHref(message)}
        target="_blank"
        rel="noreferrer"
        className="btn-pill flex w-full items-center justify-center bg-soul-blue py-3.5 text-sm font-semibold text-white"
      >
        Inquire on WhatsApp
      </a>
      <p className="mt-3 text-center text-[12px] text-soul-muted">
        Our team will share details and arrange a viewing.
      </p>
    </div>
  );
}
