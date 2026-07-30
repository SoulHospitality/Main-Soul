import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Full-screen shell for creating manual reservations.
 * Children fill the viewport (scroll body + sticky footer).
 */
export default function AdminReservationDrawer({
  open,
  onClose,
  title = 'New Reservation',
  subtitle = 'Cash or InstaPay · pending until payment is collected',
  children,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] bg-[#f6f8fb]">
      <section className="flex h-[100dvh] w-full flex-col">
        <header className="flex-shrink-0 px-4 pb-3 pt-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-[1280px]">
            <button
              type="button"
              onClick={onClose}
              className="mb-5 text-sm font-semibold text-[#1e5fbf] hover:underline"
            >
              ← Reservations
            </button>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-2xl font-semibold tracking-tight text-[#0f1c2e]">
                  {title}
                </h2>
                {subtitle ? <p className="mt-1 text-sm text-[#5b6b80]">{subtitle}</p> : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="text-sm font-semibold text-[#5b6b80] hover:text-[#0f1c2e]"
              >
                Cancel
              </button>
            </div>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </section>
    </div>,
    document.body
  );
}
