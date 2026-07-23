import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, X } from 'lucide-react';
import api from '../api/axios';
import { idDocumentPagePreviewUrl, isPdfUrl } from '../utils/idDocuments';

/**
 * Full-screen ID document review: images as-is; PDFs via Cloudinary page preview
 * plus authenticated inline PDF stream from the API.
 */
export default function IdDocumentPreviewModal({
  urls = [],
  index = 0,
  onClose,
  onIndexChange,
  zClass = 'z-50',
}) {
  const [pdfBlobUrl, setPdfBlobUrl] = useState('');
  const [pdfError, setPdfError] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);

  const list = (urls || []).filter(Boolean);
  const current = list[index] || '';
  const pdf = isPdfUrl(current);
  const pagePreview = pdf ? idDocumentPagePreviewUrl(current, 1) : null;

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';

    async function loadPdf() {
      setPdfBlobUrl('');
      setPdfError('');
      if (!pdf || !current) return;

      setPdfLoading(true);
      try {
        const res = await api.get('/id-documents/view', {
          params: { url: current },
          responseType: 'blob',
        });
        if (cancelled) return;
        const type = res.data?.type || 'application/pdf';
        // Cloudinary sometimes returns HTML error pages with 200 — detect that
        if (type.includes('text/html')) {
          setPdfError(
            'PDF delivery is blocked or the file is unavailable. Showing page preview if available.'
          );
          return;
        }
        objectUrl = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
        setPdfBlobUrl(objectUrl);
      } catch (e) {
        if (!cancelled) {
          let message =
            'Could not open this PDF. Re-upload the ID, or enable PDF delivery in Cloudinary.';
          const data = e.response?.data;
          if (data instanceof Blob) {
            try {
              const text = await data.text();
              const parsed = JSON.parse(text);
              if (parsed?.error) message = parsed.error;
            } catch {
              /* keep default */
            }
          } else if (data?.error) {
            message = data.error;
          }
          setPdfError(message);
        }
      } finally {
        if (!cancelled) setPdfLoading(false);
      }
    }

    loadPdf();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [current, pdf]);

  if (!list.length || !current) return null;

  return (
    <div
      className={`fixed inset-0 ${zClass} flex items-center justify-center bg-black/70 p-4`}
      onClick={onClose}
    >
      <div
        className={`relative max-h-[90vh] ${pdf ? 'w-full max-w-5xl' : 'max-w-3xl'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute -right-2 -top-2 z-10 rounded-full bg-white p-1.5 text-gray-700 shadow"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        {pdf ? (
          <div className="overflow-hidden rounded-lg bg-white shadow-lg">
            {pdfBlobUrl ? (
              <iframe title="ID PDF preview" src={pdfBlobUrl} className="h-[75vh] w-full border-0" />
            ) : pagePreview ? (
              <div className="bg-slate-100 p-3">
                <img
                  src={pagePreview}
                  alt="ID PDF page preview"
                  className="mx-auto max-h-[70vh] max-w-full object-contain"
                />
                {pdfLoading ? (
                  <p className="mt-2 text-center text-xs text-gray-500">Loading full PDF…</p>
                ) : null}
                {pdfError ? (
                  <p className="mt-2 text-center text-xs text-amber-700">{pdfError}</p>
                ) : null}
              </div>
            ) : (
              <div className="flex h-[50vh] flex-col items-center justify-center gap-3 p-8 text-center">
                <FileText className="h-12 w-12 text-rose-600" />
                <p className="text-sm text-gray-700">
                  {pdfLoading ? 'Loading PDF…' : pdfError || 'Unable to preview this PDF.'}
                </p>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-center gap-3 border-t px-4 py-2">
              {pdfBlobUrl ? (
                <a
                  href={pdfBlobUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-soul-blue underline"
                >
                  Open PDF in new tab
                </a>
              ) : null}
              {pagePreview && pdfBlobUrl ? (
                <a
                  href={pagePreview}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-gray-600 underline"
                >
                  Open page image
                </a>
              ) : null}
            </div>
          </div>
        ) : (
          <img
            src={current}
            alt="ID preview"
            className="max-h-[85vh] max-w-full rounded-lg object-contain"
          />
        )}

        {list.length > 1 && (
          <div className="mt-3 flex items-center justify-center gap-3">
            <button
              type="button"
              className="rounded-full bg-white/90 p-2 text-gray-700 shadow"
              onClick={() => onIndexChange?.((index - 1 + list.length) % list.length)}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm text-white">
              {index + 1} / {list.length}
            </span>
            <button
              type="button"
              className="rounded-full bg-white/90 p-2 text-gray-700 shadow"
              onClick={() => onIndexChange?.((index + 1) % list.length)}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
