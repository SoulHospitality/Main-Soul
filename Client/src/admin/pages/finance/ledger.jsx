import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CircleDashed, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import api from '../../api/axios';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import { currency, formatDate, formatDateTime } from '../../utils/formatters';
import { useFinLocale } from '../../context/FinLocaleContext';
import DataTable from './DataTable';
import { TimelineLink } from './workspace';

/**
 * The stored, immutable ledger (migration 176) and its controls, read-only. Nothing on this page changes the
 * ledger: posting, policy approvals and snapshot corrections go through the verified procedures.
 */

function Pill({ tone = 'gray', children }) {
  const tones = {
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-800',
    red: 'bg-rose-50 text-rose-700',
    blue: 'bg-sky-50 text-soul-blue',
    gray: 'bg-slate-100 text-gray-600',
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

function Tile({ label, value, sub }) {
  return (
    <div className="rounded-2xl border border-soul-line bg-white px-5 py-4">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-gray-500">{sub}</p> : null}
    </div>
  );
}

function Section({ title, hint, right, children }) {
  return (
    <section className="rounded-2xl border border-soul-line bg-white p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-soul-blue">{title}</h2>
          {hint ? <p className="text-xs text-gray-500">{hint}</p> : null}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function identityTone(status) {
  return status === 'configured' ? 'green' : status === 'invalid' ? 'red' : 'amber';
}

export function useLedgerControls() {
  return useQuery({
    queryKey: ['financial-system-ledger-controls'],
    queryFn: () => api.get('/financial-system/ledger-controls').then((r) => r.data),
    staleTime: 60_000,
  });
}

export function useCommissionReview() {
  return useQuery({
    queryKey: ['financial-system-commission-review'],
    queryFn: () => api.get('/financial-system/commission-review').then((r) => r.data),
    staleTime: 60_000,
  });
}

export function LedgerControlsPage() {
  const { t } = useFinLocale();
  const { data, isLoading, isError } = useLedgerControls();
  if (isLoading) return <LoadingSpinner />;
  if (isError || !data) return <p className="text-sm text-rose-700">{t('pms.fin.ledger.loadError')}</p>;

  if (!data.deployed) {
    return (
      <div className="space-y-5">
        <p className="max-w-3xl text-sm text-gray-500">{t('pms.fin.ledger.intro')}</p>
        <div className="flex items-start gap-3 rounded-2xl border border-soul-line bg-white px-5 py-4">
          <CircleDashed className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" />
          <div>
            <p className="font-semibold text-gray-900">{t('pms.fin.ledger.notDeployedTitle')}</p>
            <p className="text-sm text-gray-500">{t('pms.fin.ledger.notDeployedBody')}</p>
          </div>
        </div>
      </div>
    );
  }

  const posting = data.posting || {};
  const on = posting.state === 'on';
  const g = data.gates || {};
  const gates = [
    { id: 'revenue', done: g.revenue_presentation === true },
    { id: 'vat', done: g.vat_base === true },
    { id: 'commission', done: null },
    { id: 'identity', done: data.identity === 'configured' },
  ];
  const ledger = data.ledger || {};

  return (
    <div className="space-y-5">
      <p className="max-w-3xl text-sm text-gray-500">{t('pms.fin.ledger.intro')}</p>

      <div className={`flex flex-wrap items-center gap-3 rounded-2xl border px-5 py-4 ${on ? 'border-emerald-200 bg-emerald-50/50' : 'border-soul-line bg-white'}`}>
        {on ? <ShieldCheck className="h-6 w-6 text-emerald-600" /> : <Lock className="h-6 w-6 text-soul-blue" />}
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gray-900">{on ? t('pms.fin.ledger.postingOn') : t('pms.fin.ledger.postingOff')}</p>
          <p className="text-xs text-gray-500">
            {!posting.last_change
              ? t('pms.fin.ledger.neverChanged')
              : posting.last_change.actor_name
                ? t('pms.fin.ledger.lastChange', {
                    who: posting.last_change.actor_name,
                    when: formatDateTime(posting.last_change.changed_at),
                  })
                : t('pms.fin.ledger.installedOff', { when: formatDateTime(posting.last_change.changed_at) })}
          </p>
        </div>
        <Pill tone={on ? 'green' : 'gray'}>{on ? t('pms.fin.ledger.on') : t('pms.fin.ledger.off')}</Pill>
      </div>

      <Section title={t('pms.fin.ledger.gatesTitle')} hint={t('pms.fin.ledger.gatesHint')}>
        <ol className="space-y-2">
          {gates.map((s, i) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-soul-line/70 px-4 py-2.5">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                  s.done === true ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-gray-600'
                }`}
              >
                {s.done === true ? '✓' : i + 1}
              </span>
              <span className="min-w-0 flex-1 text-sm">
                <span className="font-medium">{t(`pms.fin.ledger.gates.${s.id}.title`)}</span>
                <span className="block text-xs text-gray-500">{t(`pms.fin.ledger.gates.${s.id}.what`)}</span>
              </span>
              {s.id === 'identity' ? (
                <Pill tone={identityTone(data.identity)}>{t(`pms.fin.ledger.identity.${data.identity}`)}</Pill>
              ) : s.done === null ? (
                <Pill tone="blue">{t('pms.fin.ledger.outsideSystem')}</Pill>
              ) : (
                <Pill tone={s.done ? 'green' : 'amber'}>{s.done ? t('pms.fin.ledger.approved') : t('pms.fin.ledger.awaiting')}</Pill>
              )}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-gray-500">{t('pms.fin.ledger.gatesFoot')}</p>
      </Section>

      <Section title={t('pms.fin.ledger.policiesTitle')} hint={t('pms.fin.ledger.policiesHint')}>
        <DataTable
          rows={data.policies || []}
          rowKey={(r) => r.version}
          exportName="ledger-policies"
          emptyText={t('pms.fin.ledger.noPolicies')}
          columns={[
            { key: 'version', label: t('pms.fin.ledger.col.version'), nowrap: true },
            { key: 'effective_from', label: t('pms.fin.ledger.col.effective'), nowrap: true, render: (r) => formatDate(r.effective_from) },
            {
              key: 'status',
              label: t('pms.fin.ledger.col.status'),
              render: (r) => <Pill tone={r.status === 'approved' ? 'green' : r.status === 'retired' ? 'gray' : 'amber'}>{t(`pms.fin.ledger.policyStatus.${r.status}`)}</Pill>,
            },
            { key: 'revenue_presentation', label: t('pms.fin.ledger.col.revenue'), render: (r) => r.revenue_presentation || '—' },
            { key: 'vat_base', label: t('pms.fin.ledger.col.vat'), render: (r) => r.vat_base || '—' },
            {
              key: 'approved_at',
              label: t('pms.fin.ledger.col.d01Approval'),
              render: (r) =>
                r.d01_approved ? (
                  <span className="text-xs">{r.approved_by_name} · {formatDate(r.approved_at)}<br /><span className="text-gray-500">{r.approval_ref}</span></span>
                ) : (
                  <Pill tone="amber">{t('pms.fin.ledger.awaiting')}</Pill>
                ),
            },
            {
              key: 'vat_approved_at',
              label: t('pms.fin.ledger.col.vatApproval'),
              render: (r) =>
                r.vat_approved ? (
                  <span className="text-xs">{r.vat_approved_by_name} · {formatDate(r.vat_approved_at)}<br /><span className="text-gray-500">{r.vat_approval_ref}</span></span>
                ) : (
                  <Pill tone="amber">{t('pms.fin.ledger.awaiting')}</Pill>
                ),
            },
            { key: 'created_by_name', label: t('pms.fin.ledger.col.recordedBy'), render: (r) => r.created_by_name || '—' },
          ]}
        />
      </Section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label={t('pms.fin.ledger.entries')} value={ledger.entries ?? 0} sub={t('pms.fin.ledger.lines', { count: ledger.lines ?? 0 })} />
        <Tile label={t('pms.fin.ledger.reversed')} value={ledger.reversed ?? 0} />
        <Tile label={t('pms.fin.ledger.manualMigrated')} value={`${ledger.manual ?? 0} / ${ledger.migrated ?? 0}`} />
        <Tile label={t('pms.fin.ledger.lastEntry')} value={ledger.last_entry_at ? formatDate(ledger.last_entry_at) : '—'} />
      </div>

      {data.periods?.length ? (
        <Section title={t('pms.fin.ledger.periodsTitle')}>
          <DataTable
            rows={data.periods}
            rowKey={(r) => r.period}
            exportName="ledger-periods"
            columns={[
              { key: 'period', label: t('pms.fin.ledger.col.period'), nowrap: true },
              { key: 'status', label: t('pms.fin.ledger.col.status'), render: (r) => <Pill tone={r.status === 'closed' ? 'gray' : 'green'}>{t(`pms.fin.ledger.periodStatus.${r.status}`)}</Pill> },
              { key: 'closed_at', label: t('pms.fin.ledger.col.closed'), render: (r) => (r.closed_at ? `${r.closed_by_name || '—'} · ${formatDate(r.closed_at)}` : '—') },
              { key: 'reopen_reason', label: t('pms.fin.ledger.col.reopened'), render: (r) => (r.reopened_at ? `${formatDate(r.reopened_at)} · ${r.reopen_reason || ''}` : '—') },
            ]}
          />
        </Section>
      ) : null}

      <Section title={t('pms.fin.ledger.logTitle')} hint={t('pms.fin.ledger.logHint')}>
        <DataTable
          rows={data.control_log || []}
          rowKey={(r) => `${r.control}-${r.changed_at}`}
          exportName="ledger-control-log"
          emptyText={t('pms.fin.ledger.noLog')}
          columns={[
            { key: 'changed_at', label: t('pms.fin.ledger.col.when'), nowrap: true, render: (r) => formatDateTime(r.changed_at) },
            { key: 'control', label: t('pms.fin.ledger.col.control'), render: (r) => (r.control === 'ledger_posting' ? t('pms.fin.ledger.postingSwitch') : r.control) },
            {
              key: 'change',
              label: t('pms.fin.ledger.col.change'),
              render: (r) => {
                const v = (x) => (x === 'on' ? t('pms.fin.ledger.on') : x === 'off' ? t('pms.fin.ledger.off') : x ?? '—');
                return `${v(r.old_value)} → ${v(r.new_value)}`;
              },
            },
            { key: 'actor_name', label: t('pms.fin.ledger.col.who'), render: (r) => r.actor_name || t('pms.fin.ledger.system') },
            { key: 'reason', label: t('pms.fin.ledger.col.reason'), render: (r) => r.reason || '—' },
          ]}
        />
      </Section>

      <p className="flex items-start gap-2 text-xs text-gray-500">
        <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {t('pms.fin.ledger.readOnlyNote')}
      </p>
    </div>
  );
}

export function CommissionReviewPage() {
  const { t } = useFinLocale();
  const { data, isLoading, isError } = useCommissionReview();
  if (isLoading) return <LoadingSpinner />;
  if (isError || !data) return <p className="text-sm text-rose-700">{t('pms.fin.ledger.loadError')}</p>;
  if (!data.deployed) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-soul-line bg-white px-5 py-4">
        <CircleDashed className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" />
        <div>
          <p className="font-semibold text-gray-900">{t('pms.fin.commissionReview.notDeployedTitle')}</p>
          <p className="text-sm text-gray-500">{t('pms.fin.commissionReview.notDeployedBody')}</p>
        </div>
      </div>
    );
  }
  const c = data.counts || {};
  const waiting = data.review_total || 0;
  return (
    <div className="space-y-5">
      <p className="max-w-3xl text-sm text-gray-500">
        {t('pms.fin.commissionReview.intro', { since: data.since ? formatDateTime(data.since) : '—' })}
      </p>

      <div className={`flex flex-wrap items-center gap-3 rounded-2xl border px-5 py-4 ${waiting ? 'border-amber-200 bg-amber-50/40' : 'border-emerald-200 bg-emerald-50/50'}`}>
        {waiting ? <AlertTriangle className="h-5 w-5 text-amber-600" /> : <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
        <p className="min-w-0 flex-1 font-semibold text-gray-900">
          {waiting ? t('pms.fin.commissionReview.waiting', { count: waiting }) : t('pms.fin.commissionReview.clear')}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label={t('pms.fin.commissionReview.captured')} value={c.captured} sub={t('pms.fin.commissionReview.capturedSub')} />
        <Tile label={t('pms.fin.commissionReview.needsReview')} value={c.needs_review} sub={t('pms.fin.commissionReview.needsReviewSub')} />
        <Tile label={t('pms.fin.commissionReview.none')} value={c.none} sub={t('pms.fin.commissionReview.noneSub')} />
        <Tile
          label={t('pms.fin.commissionReview.corrected')}
          value={c.corrected}
          sub={data.corrections?.last_at ? t('pms.fin.commissionReview.lastCorrection', { when: formatDate(data.corrections.last_at) }) : null}
        />
      </div>

      <Section title={t('pms.fin.commissionReview.listTitle')} hint={t('pms.fin.commissionReview.listHint')}>
        <DataTable
          rows={data.rows || []}
          rowKey={(r) => r.reservation_id}
          exportName="commission-review"
          emptyText={t('pms.fin.commissionReview.clear')}
          columns={[
            {
              key: 'guest_name',
              label: t('pms.fin.commissionReview.col.stay'),
              render: (r) => <TimelineLink id={r.reservation_id}>{r.guest_name || `#${r.reservation_id}`}</TimelineLink>,
            },
            { key: 'unit_title', label: t('pms.fin.commissionReview.col.unit'), nowrap: true, render: (r) => r.unit_title || '—' },
            { key: 'check_in', label: t('pms.fin.commissionReview.col.dates'), nowrap: true, render: (r) => `${formatDate(r.check_in)} → ${formatDate(r.check_out)}` },
            {
              key: 'status',
              label: t('pms.fin.commissionReview.col.status'),
              nowrap: true,
              render: (r) => <Pill>{['confirmed', 'checked_in', 'checked_out'].includes(r.status) ? t(`pms.fin.commissionReview.stayStatus.${r.status}`) : r.status}</Pill>,
            },
            { key: 'total_amount', label: t('pms.fin.commissionReview.col.total'), align: 'end', render: (r) => currency(r.total_amount, r.currency || 'EGP') },
            { key: 'salesperson', label: t('pms.fin.commissionReview.col.salesperson'), render: (r) => r.salesperson || '—' },
            {
              key: 'review_reason',
              label: t('pms.fin.commissionReview.col.reason'),
              nowrap: true,
              value: (r) => (r.commission_snapshot_status === 'needs_review' ? t('pms.fin.commissionReview.reasonFlagged') : t('pms.fin.commissionReview.reasonHistorical')),
              render: (r) => {
                const flagged = r.commission_snapshot_status === 'needs_review';
                return (
                  <span title={flagged ? t('pms.fin.commissionReview.reasonFlagged') : t('pms.fin.commissionReview.reasonHistorical')}>
                    <Pill tone={flagged ? 'amber' : 'blue'}>{flagged ? t('pms.fin.commissionReview.reasonFlaggedShort') : t('pms.fin.commissionReview.reasonHistoricalShort')}</Pill>
                  </span>
                );
              },
            },
          ]}
        />
      </Section>
      <p className="text-xs text-gray-500">{t('pms.fin.commissionReview.howToCorrect')}</p>
    </div>
  );
}

/** Warning shown above the statements when the books contain lines on accounts missing from the chart (DEF-ACC-01). */
export function IntegrityBanner({ integrity }) {
  const { t } = useFinLocale();
  const list = integrity?.unknown_accounts || [];
  if (!list.length) return null;
  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50/50 px-5 py-4">
      <p className="flex items-center gap-2 font-semibold text-rose-800">
        <AlertTriangle className="h-5 w-5" /> {t('pms.fin.integrity.title', { count: list.length })}
      </p>
      <p className="mt-1 text-xs text-rose-900/80">{t('pms.fin.integrity.body')}</p>
      <ul className="mt-2 space-y-1 text-sm">
        {list.map((u) => (
          <li key={u.account} className="tabular-nums">
            <span className="font-mono font-semibold">{u.account}</span> · {t('pms.fin.integrity.line', { debit: currency(u.debit), credit: currency(u.credit), count: u.entries?.length || 0 })}
          </li>
        ))}
      </ul>
    </div>
  );
}
