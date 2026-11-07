import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Download, Printer } from 'lucide-react';
import api from '../api/http';
import { buildReservationReceiptHtml } from '../admin/utils/reservationReceipt';
import { downloadDocumentPdf, openDocument } from '../admin/utils/brandDocument';

/** The guest's receipt, opened from the link sent on WhatsApp. */
export default function ReceiptPage() {
  const { token } = useParams();
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const frameRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/receipts/${encodeURIComponent(token)}`)
      .then(({ data }) => !cancelled && setReceipt(data))
      .catch(() => !cancelled && setError('This receipt link is not valid. Please ask Soul Hospitality for a new one.'));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const html = useMemo(() => (receipt ? buildReservationReceiptHtml(receipt, { actions: false }) : ''), [receipt]);

  const download = async () => {
    setBusy(true);
    try {
      await downloadDocumentPdf(html, `Soul_receipt_SH-${receipt.id}.pdf`);
    } catch {
      openDocument(buildReservationReceiptHtml(receipt));
    } finally {
      setBusy(false);
    }
  };

  const fit = () => {
    const doc = frameRef.current?.contentDocument;
    if (doc?.body) frameRef.current.style.height = `${doc.documentElement.scrollHeight + 4}px`;
  };

  return (
    <main className="min-h-screen bg-[#eef2f6] px-3 pb-12 pt-24 sm:pt-28">
      <div className="mx-auto max-w-[860px]">
        {error ? (
          <p className="rounded-2xl bg-white p-8 text-center text-slate-600 shadow-sm">{error}</p>
        ) : !receipt ? (
          <p className="p-10 text-center text-slate-500">Loading your receipt…</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => openDocument(buildReservationReceiptHtml(receipt))} className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                <Printer className="h-4 w-4" /> Print
              </button>
              <button type="button" onClick={download} disabled={busy} className="inline-flex items-center gap-1.5 rounded-full bg-[#0b2f4a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0b4f73] disabled:opacity-60">
                <Download className="h-4 w-4" /> {busy ? 'Preparing…' : 'Download PDF'}
              </button>
            </div>
            <iframe ref={frameRef} title="Receipt" srcDoc={html} onLoad={fit} className="h-[1000px] w-full border-0 bg-transparent" />
          </>
        )}
      </div>
    </main>
  );
}
