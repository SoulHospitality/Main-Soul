import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText, X } from 'lucide-react';
import api from '../api/axios';
import { idDocumentPagePreviewUrl, isPdfUrl } from '../utils/idDocuments';

/**
 * Clean full-screen lightbox for guest ID / passport images and PDFs.
 */
export default function IdDocumentPreviewModal({
  urls = [],
  index = 0,
  onClose,
  onIndexChange,
  zClass = 'z-[80]',
}) {
  const [pdfBlobUrl, setPdfBlobUrl] = useState('');
  const [pdfError, setPdfError] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  const list = (urls || []).filter(Boolean);
  const safeIndex = Math.min(Math.max(0, index), Math.max(0, list.length - 1));
  const current = list[safeIndex] || '';
  const pdf = isPdfUrl(current);
  const pagePreview = pdf ? idDocumentPagePreviewUrl(current, 1) : null;

  useEffect(() => {
    setImgLoaded(false);
  }, [current]);

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
        if (type.includes('text/html')) {
          setPdfError('PDF unavailable — showing page preview when possible.');
          return;
        }
        objectUrl = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
        setPdfBlobUrl(objectUrl);
      } catch (e) {
        if (!cancelled) {
          let message = 'Could not open this PDF.';
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

  useEffect(() => {
    if (!list.length) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if (e.key === 'ArrowLeft' && list.length > 1) {
        onIndexChange?.((safeIndex - 1 + list.length) % list.length);
      }
      if (e.key === 'ArrowRight' && list.length > 1) {
        onIndexChange?.((safeIndex + 1) % list.length);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [list.length, safeIndex, onClose, onIndexChange]);

  if (!list.length || !current) return null;

  const goPrev = () => onIndexChange?.((safeIndex - 1 + list.length) % list.length);
  const goNext = () => onIndexChange?.((safeIndex + 1) % list.length);

  return (
    <div
      className={`fixed inset-0 ${zClass} flex flex-col bg-black/85 backdrop-blur-[2px]`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Document preview"
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-3 text-white/90"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0">
          <p className="text-sm font-medium tracking-wide">
            {pdf ? 'ID / Passport PDF' : 'ID / Passport photo'}
          </p>
          {list.length > 1 ? (
            <p className="text-xs text-white/55">
              {safeIndex + 1} of {list.length}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          {pdf && pdfBlobUrl ? (
            <>
              <a
                href={pdfBlobUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white"
                title="Open in new tab"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </a>
              <a
                href={pdfBlobUrl}
                download="id-document.pdf"
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white"
                title="Download"
              >
                <Download className="h-3.5 w-3.5" />
                Save
              </a>
            </>
          ) : null}
          {!pdf ? (
            <a
              href={current}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white"
              title="Open original"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open
            </a>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Stage */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-12 pb-8 pt-2">
        {list.length > 1 ? (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                goPrev();
              }}
              className="absolute left-3 top-1/2 z-10 -translate-y-1/2 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white shadow-lg backdrop-blur-sm hover:bg-white/20"
              aria-label="Previous"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                goNext();
              }}
              className="absolute right-3 top-1/2 z-10 -translate-y-1/2 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white shadow-lg backdrop-blur-sm hover:bg-white/20"
              aria-label="Next"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        ) : null}

        <div
          className="relative flex h-full w-full max-w-5xl items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          {pdf ? (
            pdfBlobUrl ? (
              <div className="flex h-full max-h-[calc(100vh-7rem)] w-full overflow-hidden rounded-xl bg-[#111] shadow-2xl ring-1 ring-white/10">
                <iframe
                  title="ID PDF preview"
                  src={`${pdfBlobUrl}#toolbar=1&navpanes=0&view=FitH`}
                  className="h-full min-h-[70vh] w-full border-0 bg-white"
                />
              </div>
            ) : pagePreview ? (
              <div className="relative flex max-h-[calc(100vh-7rem)] max-w-full items-center justify-center">
                {pdfLoading || !imgLoaded ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/25 border-t-white" />
                  </div>
                ) : null}
                <img
                  src={pagePreview}
                  alt="ID PDF page preview"
                  onLoad={() => setImgLoaded(true)}
                  className={`max-h-[calc(100vh-7rem)] max-w-full rounded-xl object-contain shadow-2xl ring-1 ring-white/10 ${
                    imgLoaded ? 'opacity-100' : 'opacity-0'
                  } transition-opacity duration-200`}
                />
                {pdfError ? (
                  <p className="absolute bottom-3 left-1/2 w-[min(90%,24rem)] -translate-x-1/2 rounded-lg bg-black/70 px-3 py-1.5 text-center text-xs text-amber-200">
                    {pdfError}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-xl bg-white/5 px-10 py-12 text-center ring-1 ring-white/10">
                <FileText className="h-10 w-10 text-white/70" />
                <p className="text-sm text-white/80">
                  {pdfLoading ? 'Loading PDF…' : pdfError || 'Unable to preview this PDF.'}
                </p>
              </div>
            )
          ) : (
            <div className="relative flex max-h-[calc(100vh-7rem)] max-w-full items-center justify-center">
              {!imgLoaded ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/25 border-t-white" />
                </div>
              ) : null}
              <img
                src={current}
                alt="ID preview"
                onLoad={() => setImgLoaded(true)}
                className={`max-h-[calc(100vh-7rem)] max-w-full rounded-xl object-contain shadow-2xl ring-1 ring-white/10 ${
                  imgLoaded ? 'opacity-100' : 'opacity-0'
                } transition-opacity duration-200`}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
