import { X } from 'lucide-react';

/**
 * Guest-style side drawer shell for creating manual reservations.
 * Children should fill height (scroll body + sticky footer).
 */
export default function AdminReservationDrawer({
  open,
  onClose,
  title = 'New Reservation',
  subtitle = 'Cash or InstaPay · pending until payment is collected',
  children,
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-slate-950/55 backdrop-blur-[2px]">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-none flex-col bg-white shadow-2xl lg:ml-auto lg:max-w-[50.4rem] lg:border-l lg:border-soul-line">
        <header className="flex items-center justify-between border-b border-soul-line px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-soul-muted">Manual booking</p>
            <h2 className="mt-1 text-2xl font-semibold text-soul-blue">{title}</h2>
            {subtitle ? <p className="mt-1 text-sm text-soul-muted">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-soul-line text-soul-muted hover:border-soul-blue hover:text-soul-blue"
            aria-label="Close drawer"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </aside>
    </div>
  );
}
