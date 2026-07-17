import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export default function Modal({ open, onClose, title, children, size = 'md', footer }) {
  const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl', full: 'max-w-6xl' };

  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  // Portal to body so position:fixed is not trapped by ancestor transforms
  // (e.g. Layout `.soul-fade-up` animation leaves transform: translateY(0)).
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl w-full ${sizes[size] || sizes.md} animate-slide-in max-h-[90vh] flex flex-col border border-soul-line`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-soul-line flex-shrink-0 bg-[var(--pms-header-tint,transparent)]">
          <h2 className="font-display text-xl text-soul-blue tracking-wide">{title}</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-xl text-soul-muted hover:text-soul-blue hover:bg-black/[0.04] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-5">{children}</div>
        {footer && (
          <div className="px-6 py-4 border-t border-soul-line flex-shrink-0 flex items-center justify-end gap-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
