import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, History, Receipt, Search, X } from 'lucide-react';
import api from '../../api/axios';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import { currency, formatDate, formatDateTime } from '../../utils/formatters';
import { getAccount } from '../../../lib/finance/chartOfAccounts';
import { useFinLocale } from '../../context/FinLocaleContext';

/** Lets any Financial System page open a reservation's money timeline or jump to another page. */
const WorkspaceContext = createContext({ openTimeline: () => {}, openTool: () => {} });
export const useWorkspace = () => useContext(WorkspaceContext);

export function WorkspaceProvider({ openTool, children }) {
  const [timelineId, setTimelineId] = useState(null);
  const value = useMemo(() => ({ openTimeline: (id) => id && setTimelineId(id), openTool }), [openTool]);
  return (
    <WorkspaceContext.Provider value={value}>
      {children}
      {timelineId ? <MoneyTimeline reservationId={timelineId} onClose={() => setTimelineId(null)} /> : null}
    </WorkspaceContext.Provider>
  );
}

/** A guest name that opens the money timeline. */
export function TimelineLink({ id, children, className = '' }) {
  const { openTimeline } = useWorkspace();
  if (!id) return <span className={className}>{children}</span>;
  return (
    <button
      type="button"
      className={`text-start font-medium text-soul-blue hover:underline ${className}`}
      onClick={(e) => {
        e.stopPropagation();
        openTimeline(id);
      }}
    >
      {children}
    </button>
  );
}

function Pill({ tone = 'slate', children }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-800',
    red: 'bg-rose-50 text-rose-700',
    blue: 'bg-soul-blue-50 text-soul-blue',
  };
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${tones[tone]}`}>{children}</span>;
}

function actionLabel(t, action) {
  const key = `pms.fin.timeline.actions.${action}`;
  const label = t(key);
  return label === key ? String(action || '').toLowerCase().replace(/_/g, ' ') : label;
}

export function MoneyTimeline({ reservationId, onClose }) {
  const { t } = useFinLocale();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['finance-money-timeline', reservationId],
    queryFn: () => api.get(`/financial-system/reservations/${reservationId}/money`).then((r) => r.data),
  });

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const r = data?.reservation;
  const bill = data?.bill;
  const lines = bill
    ? [
        [t('pms.fin.timeline.accommodation', { nights: bill.nights || 0 }), bill.accommodation],
        [t('pms.fin.timeline.housekeeping'), bill.housekeeping],
        [t('pms.fin.timeline.beach'), bill.beach],
        [t('pms.fin.timeline.insurance'), bill.insurance],
        [t('pms.fin.timeline.service'), bill.service],
      ].filter(([, v]) => Number(v) > 0)
    : [];

  return (
    <div className="fixed inset-0 z-[210] flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-soul-line px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-gray-400">{t('pms.fin.timeline.title')} · #{reservationId}</p>
            <h2 className="truncate text-lg font-semibold text-soul-blue">{r?.guest_name || '…'}</h2>
            {r ? (
              <p className="text-xs text-gray-500">
                {r.unit_name}
                {r.project ? ` · ${r.project}` : ''} · {formatDate(r.check_in)} → {formatDate(r.check_out)} · {r.status}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            <a href={`/admin/reservations?search=${encodeURIComponent(r?.guest_name || reservationId)}`} className="btn-secondary !px-2.5 !py-1.5 text-xs">
              <ExternalLink className="h-3.5 w-3.5" /> {t('pms.fin.timeline.openReservation')}
            </a>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-500 hover:bg-slate-100" aria-label={t('pms.fin.timeline.closePanel')}>
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {isLoading ? <LoadingSpinner /> : null}
          {isError ? <p className="text-sm text-rose-600">{t('pms.fin.timeline.failed')}</p> : null}
          {bill ? (
            <section className="rounded-xl border border-soul-line">
              <div className="space-y-1 p-4 text-sm">
                {lines.map(([label, v]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <span className="text-gray-500">{label}</span>
                    <span className="tabular-nums">{currency(v)}</span>
                  </div>
                ))}
                <div className="flex justify-between gap-3 border-t border-soul-line pt-1 font-semibold">
                  <span>{t('pms.fin.timeline.fullBill')}</span>
                  <span className="tabular-nums">{currency(bill.total)}</span>
                </div>
                {bill.ownerCollected > 0 ? (
                  <div className="flex justify-between gap-3 text-gray-500">
                    <span>{t('pms.fin.timeline.ownerCollected')}</span>
                    <span className="tabular-nums">− {currency(bill.ownerCollected)}</span>
                  </div>
                ) : null}
                <div className="flex justify-between gap-3 text-emerald-700">
                  <span>{t('pms.fin.timeline.paid')}</span>
                  <span className="tabular-nums">− {currency(bill.paid)}</span>
                </div>
              </div>
              <div className={`flex justify-between gap-3 rounded-b-xl px-4 py-2.5 text-sm font-bold ${bill.toCollect > 0.5 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
                <span>{bill.toCollect > 0.5 ? t('pms.fin.timeline.toCollect') : t('pms.fin.timeline.settled')}</span>
                <span className="tabular-nums">{currency(bill.toCollect)}</span>
              </div>
            </section>
          ) : null}

          {data ? (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-soul-blue">{t('pms.fin.timeline.money')}</h3>
              {data.payments.length ? (
                <ul className="divide-y divide-soul-line rounded-xl border border-soul-line">
                  {data.payments.map((p) => {
                    const refund = Number(p.amount) < 0;
                    return (
                      <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-sm">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium">{formatDate(p.date)}</span>
                            <span className="text-gray-500">{String(p.payment_method || '').replace(/_/g, ' ')}</span>
                            {p.is_down_payment ? <Pill tone="blue">{t('pms.fin.timeline.downPayment')}</Pill> : null}
                            {refund ? <Pill tone="red">{t('pms.fin.timeline.refund')}</Pill> : null}
                            {p.status === 'pending' ? <Pill tone="amber">{t('pms.fin.timeline.awaitingApproval')}</Pill> : null}
                            {['cancelled', 'failed'].includes(p.status) ? <Pill>{p.status}</Pill> : null}
                            {p.finance_review_status === 'pending' ? <Pill tone="amber">{t('pms.fin.timeline.financeCheck')}</Pill> : null}
                            {p.finance_review_status === 'reviewed' ? <Pill tone="green">{t('pms.fin.timeline.financeChecked')}</Pill> : null}
                          </div>
                          <p className="text-xs text-gray-500">
                            {[p.created_by_name && t('pms.fin.timeline.by', { name: p.created_by_name }), p.reviewed_by_name && t('pms.fin.timeline.checkedBy', { name: p.reviewed_by_name }), p.reference_number || p.transaction_reference, p.notes].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <span className={`font-semibold tabular-nums ${refund ? 'text-rose-600' : p.status === 'successful' ? 'text-emerald-700' : 'text-gray-400'}`}>
                          {currency(p.amount)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-gray-400">{t('pms.fin.timeline.noPayments')}</p>
              )}
              {r?.ops_money_collected_at ? (
                <p className="text-xs text-gray-500">{t('pms.fin.timeline.opsCollected', { when: formatDateTime(r.ops_money_collected_at), name: r.ops_collected_by_name || '—' })}</p>
              ) : null}
              {data.cancel_requests.map((c) => (
                <p key={`c${c.id}`} className="text-xs text-gray-600">
                  <Pill tone={c.status === 'approved' ? 'green' : 'amber'}>{t('pms.fin.timeline.cancelRequest')}</Pill>{' '}
                  {t('pms.fin.timeline.cancelLine', { refund: currency(c.refund_amount ?? c.requested_refund), status: c.status })}
                </p>
              ))}
              {data.write_offs.map((w) => (
                <p key={`w${w.id}`} className="text-xs text-gray-600">
                  <Pill tone="red">{t('pms.fin.timeline.writeOff')}</Pill> {currency(w.amount)} · {w.status}
                </p>
              ))}
              {data.custom_bills.map((b) => (
                <p key={`b${b.id}`} className="text-xs text-gray-600">
                  <Pill tone="slate">{t('pms.fin.timeline.customBill')}</Pill> {b.status} · {b.requested_by_name || ''} · {b.comment}
                </p>
              ))}
            </section>
          ) : null}

          {data?.entries?.length ? (
            <section className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-soul-blue">
                <Receipt className="h-4 w-4" /> {t('pms.fin.timeline.entries')}
              </h3>
              <div className="space-y-2">
                {data.entries.map((e) => (
                  <div key={e.id} className="rounded-xl border border-soul-line">
                    <p className="flex justify-between gap-2 border-b border-soul-line bg-slate-50 px-3 py-1.5 text-xs">
                      <span className="font-medium">{e.description}</span>
                      <span className="text-gray-500">{formatDate(e.date)}</span>
                    </p>
                    <table className="w-full text-xs">
                      <tbody>
                        {e.lines.map((l, i) => (
                          <tr key={i} className="border-t border-soul-line/60 first:border-0">
                            <td className="px-3 py-1 font-mono text-gray-400">{l.account}</td>
                            <td className="px-1 py-1">{getAccount(l.account)?.name || l.account_name}</td>
                            <td className="px-3 py-1 text-end tabular-nums">{l.debit ? currency(l.debit) : ''}</td>
                            <td className="px-3 py-1 text-end tabular-nums">{l.credit ? currency(l.credit) : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {data?.history?.length ? (
            <section className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-soul-blue">
                <History className="h-4 w-4" /> {t('pms.fin.timeline.history')}
              </h3>
              <HistoryList items={data.history} />
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

export function HistoryList({ items }) {
  const { t } = useFinLocale();
  return (
    <ol className="space-y-1.5 border-s border-soul-line ps-4 text-xs">
      {items.map((h) => {
        const raw = h.details?.changes;
        const changes = Array.isArray(raw)
          ? raw
          : raw && typeof raw === 'object'
            ? Object.entries(raw).map(([field, c]) => ({ field, from: c?.from, to: c?.to }))
            : [];
        return (
          <li key={h.id} className="relative">
            <span className="absolute -start-[21px] top-1.5 h-2 w-2 rounded-full bg-soul-blue/60" />
            <p>
              <span className="font-medium text-gray-800">{actionLabel(t, h.action)}</span>
              <span className="text-gray-500"> · {h.actor_name || t('pms.fin.timeline.system')} · {formatDateTime(h.created_at)}</span>
            </p>
            {changes.length ? (
              <p className="text-gray-500">
                {changes.slice(0, 6).map((c) => `${c.field}: ${c.from ?? '—'} → ${c.to ?? '—'}`).join(' · ')}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** Header search: reservations, payments, expenses, journals, vendor bills and calendar payments. */
export function GlobalSearch() {
  const { t } = useFinLocale();
  const { openTimeline, openTool } = useWorkspace();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);
  useEffect(() => {
    const onDown = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ['finance-search', debounced],
    queryFn: () => api.get('/financial-system/search', { params: { q: debounced } }).then((r) => r.data),
    enabled: debounced.length >= 2,
    staleTime: 15_000,
  });

  const pick = (fn) => () => {
    fn();
    setOpen(false);
  };
  const groups = data
    ? [
        ['reservations', data.reservations.map((r) => ({
          key: `r${r.id}`,
          title: `#${r.id} · ${r.guest_name}`,
          sub: `${r.unit_name} · ${formatDate(r.check_in)} → ${formatDate(r.check_out)}`,
          amount: r.bill?.toCollect > 0.5 ? t('pms.fin.search.owes', { amount: currency(r.bill.toCollect) }) : currency(r.bill?.total),
          onPick: pick(() => openTimeline(r.id)),
        }))],
        ['payments', data.payments.map((p) => ({
          key: `p${p.id}`,
          title: `${currency(p.amount)} · ${String(p.payment_method || '').replace(/_/g, ' ')}`,
          sub: [formatDate(p.date), p.guest_name, p.reference].filter(Boolean).join(' · '),
          amount: p.status,
          onPick: pick(() => (p.reservation_id ? openTimeline(p.reservation_id) : openTool('collection'))),
        }))],
        ['bills', data.bills.map((b) => ({ key: `b${b.id}`, title: `${b.vendor_name || ''} ${b.invoice_number || ''}`, sub: formatDate(b.date), amount: currency(b.amount), onPick: pick(() => openTool('vendors')) }))],
        ['calendar', (data.calendar || []).map((c) => ({ key: `c${c.id}`, title: c.title, sub: `${formatDate(c.date)} · ${c.status}`, amount: currency(c.amount), onPick: pick(() => openTool('calendar')) }))],
        ['expenses', data.expenses.map((x) => ({ key: `e${x.id}`, title: x.description, sub: `${formatDate(x.date)} · ${x.category || ''}`, amount: currency(x.amount), onPick: pick(() => openTool('accounts')) }))],
        ['journals', data.journals.map((j) => ({ key: `j${j.id}`, title: j.description, sub: `${formatDate(j.date)} · ${j.debit_account_code || ''} / ${j.credit_account_code || ''}`, amount: currency(j.amount), onPick: pick(() => openTool('manual')) }))],
      ].filter(([, list]) => list.length)
    : [];

  return (
    <div ref={box} className="relative w-full sm:w-80">
      <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      <input
        className="input w-full py-2 ps-9 text-sm"
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        placeholder={t('pms.fin.search.placeholder')}
        aria-label={t('pms.fin.search.placeholder')}
      />
      {open && debounced.length >= 2 ? (
        <div className="absolute end-0 z-[120] mt-1 max-h-[70vh] w-[min(92vw,30rem)] overflow-y-auto rounded-2xl border border-soul-line bg-white p-2 shadow-xl">
          {isFetching && !data ? <p className="px-3 py-4 text-sm text-gray-400">{t('pms.fin.search.searching')}</p> : null}
          {data && !groups.length ? <p className="px-3 py-4 text-sm text-gray-400">{t('pms.fin.search.none', { q: debounced })}</p> : null}
          {groups.map(([id, list]) => (
            <div key={id} className="py-1">
              <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{t(`pms.fin.search.groups.${id}`)}</p>
              {list.map((item) => (
                <button key={item.key} type="button" onClick={item.onPick} className="flex w-full items-start justify-between gap-3 rounded-xl px-3 py-2 text-start hover:bg-soul-blue-50/60">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-gray-900">{item.title}</span>
                    <span className="block truncate text-xs text-gray-500">{item.sub}</span>
                  </span>
                  <span className="whitespace-nowrap text-xs font-semibold text-soul-blue tabular-nums">{item.amount}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
