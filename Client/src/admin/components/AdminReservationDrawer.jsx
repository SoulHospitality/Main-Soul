import { X } from 'lucide-react';

/**
 * Guest-style side drawer shell for creating manual reservations.
 */
export default function AdminReservationDrawer({
  open,
  onClose,
  title = 'New Reservation',
  subtitle = 'Cash or InstaPay — stays pending until payment is collected',
  footer,
  children,
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex justify-end">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <aside className="relative z-10 flex h-full w-full max-w-6xl flex-col bg-slate-50 shadow-2xl animate-in slide-in-from-right">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 sm:px-7">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close drawer"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-7">{children}</div>
        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3 sm:px-7">
            {footer}
          </footer>
        ) : null}
      </aside>
    </div>
  );
}
