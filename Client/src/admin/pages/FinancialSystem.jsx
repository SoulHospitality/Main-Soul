import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Landmark,
  Scale,
  Wallet,
  Banknote,
  Coins,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Download,
  CheckCircle2,
  PenLine,
  Plus,
  Trash2,
  BookOpen,
  PiggyBank,
  Shield,
  TrendingUp,
  Receipt,
  Briefcase,
  CircleDollarSign,
  CreditCard,
  Home,
  Zap,
  UtensilsCrossed,
  Users,
  AlertCircle,
  Settings2,
  FileSpreadsheet,
  Lock,
  Unlock,
  Building2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import SearchableSelect from '../components/ui/SearchableSelect';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import Modal from '../components/ui/Modal';
import { currency, formatDate } from '../utils/formatters';
import { FINANCIAL_EPOCH } from '../utils/financialEpoch';
import { ACCOUNT_GROUPS, getAccount } from '../../lib/finance/chartOfAccounts';
import { VAT_OUTPUT_PCT, WHT_STANDARD_PCT, WHT_REDUCED_PCT } from '../../lib/finance/taxEngine';
import { PettyCashSection } from './PettyCash';

const GROUP_META = {
  assets: {
    label: ACCOUNT_GROUPS.assets,
    icon: Landmark,
    tint: 'bg-sky-50 text-sky-800',
    tile: 'bg-sky-600',
    hint: 'What Soul holds',
  },
  liabilities: {
    label: ACCOUNT_GROUPS.liabilities,
    icon: Shield,
    tint: 'bg-amber-50 text-amber-900',
    tile: 'bg-amber-500',
    hint: 'What Soul owes',
  },
  equity: {
    label: ACCOUNT_GROUPS.equity,
    icon: PiggyBank,
    tint: 'bg-slate-100 text-slate-800',
    tile: 'bg-slate-700',
    hint: 'Capital and earnings',
  },
  revenue: {
    label: ACCOUNT_GROUPS.revenue,
    icon: TrendingUp,
    tint: 'bg-emerald-50 text-emerald-900',
    tile: 'bg-emerald-600',
    hint: 'Money Soul earns',
  },
  cogs: {
    label: ACCOUNT_GROUPS.cogs,
    icon: Receipt,
    tint: 'bg-orange-50 text-orange-900',
    tile: 'bg-orange-500',
    hint: 'Direct stay costs',
  },
  opex: {
    label: ACCOUNT_GROUPS.opex,
    icon: Briefcase,
    tint: 'bg-violet-50 text-violet-900',
    tile: 'bg-violet-600',
    hint: 'Company running costs',
  },
};

const ACCOUNT_ICONS = {
  '101000': Landmark,
  '102000': Landmark,
  '103000': Banknote,
  '104000': Banknote,
  '105000': CircleDollarSign,
  '106000': CreditCard,
  '107000': Scale,
  '202000': Users,
  '205000': Scale,
  '401000': TrendingUp,
  '508000': UtensilsCrossed,
  '604000': Home,
  '608000': Zap,
  '609000': Users,
};

function IconFor({ code, group, className = 'w-5 h-5' }) {
  const Comp = ACCOUNT_ICONS[code] || GROUP_META[group]?.icon || BookOpen;
  return <Comp className={className} />;
}

function DateFilters({ fromDate, toDate, onFrom, onTo }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-xs text-gray-500">From</label>
      <input
        type="date"
        className="input w-36 text-sm"
        min={FINANCIAL_EPOCH}
        value={fromDate}
        onChange={(e) => onFrom(e.target.value)}
      />
      <label className="text-xs text-gray-500">To</label>
      <input
        type="date"
        className="input w-36 text-sm"
        value={toDate}
        onChange={(e) => onTo(e.target.value)}
      />
    </div>
  );
}

function useFinanceNav() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view') || 'home';
  const group = searchParams.get('group') || '';
  const code = searchParams.get('code') || '';
  const txn = searchParams.get('txn') || '';
  const tabAlias = {
    owners: 'owners',
    settlements: 'owners',
    statement: 'owners',
    tax: 'tax',
    manual: 'manual',
    expenses: 'manual',
    petty: 'petty',
    'petty-cash': 'petty',
    reports: 'reports',
    aging: 'aging',
    close: 'close',
    gateway: 'gateway',
    bank: 'bank',
    trust: 'trust',
  };
  const tool = searchParams.get('tool') || tabAlias[searchParams.get('tab')] || '';

  function go(next) {
    const nextParams = new URLSearchParams(searchParams);
    Object.entries(next).forEach(([k, v]) => {
      if (v == null || v === '') nextParams.delete(k);
      else nextParams.set(k, String(v));
    });
    setSearchParams(nextParams, { replace: true });
  }

  return { view, group, code, txn, tool, go, searchParams, setSearchParams };
}

function rangeParams(fromDate, toDate) {
  return { from_date: fromDate || undefined, to_date: toDate || undefined };
}

function HomeView({ data, onOpenGroup, onOpenAccount, onOpenTreasury, onOpenTool, onExport, exporting }) {
  const groups = data?.groups || [];
  const treasury = data?.treasury || [];
  const kpis = data?.kpis || {};
  const outstanding = data?.outstanding || { amount: 0, count: 0 };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          Period {data?.from_date}
          {data?.to_date ? ` → ${data.to_date}` : ' → open'} · collected money only hits treasury
        </p>
        <button type="button" className="btn-secondary text-sm" onClick={onExport} disabled={exporting}>
          <Download className="w-4 h-4" />
          {exporting ? 'Exporting…' : 'Export Excel'}
        </button>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {[
          ['Collected in treasury', kpis.collected, 'Only paid / fully collected'],
          ['Outstanding', outstanding.amount, `${outstanding.count} stays unpaid`],
          ['Soul commission', kpis.commission, 'Net management fees'],
          ['Owner trust', kpis.owner_trust, 'Held for owners'],
        ].map(([label, amount, sub]) => (
          <div key={label} className="rounded-2xl border border-soul-line bg-white px-4 py-4">
            <p className="text-[11px] uppercase tracking-wider text-gray-400">{label}</p>
            <p className="text-xl font-bold tabular-nums text-soul-blue mt-1">{currency(amount)}</p>
            <p className="text-xs text-gray-500 mt-1">{sub}</p>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => onOpenTool('reports')}
        className={`w-full rounded-2xl border p-5 text-left transition-colors ${
          (kpis.net_profit || 0) >= 0
            ? 'border-emerald-200 bg-emerald-50/70 hover:border-emerald-300'
            : 'border-rose-200 bg-rose-50/70 hover:border-rose-300'
        }`}
      >
        <div className="flex flex-wrap items-center gap-4">
          <div
            className={`w-12 h-12 rounded-2xl text-white flex items-center justify-center ${
              (kpis.net_profit || 0) >= 0 ? 'bg-emerald-600' : 'bg-rose-600'
            }`}
          >
            <TrendingUp className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs uppercase tracking-wider text-gray-500">Soul net profit</p>
            <p className="font-semibold text-soul-blue">Revenue − COGS − operating expenses</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {currency(kpis.revenue)} revenue · {currency(kpis.cogs)} direct costs · {currency(kpis.opex)} opex
              · owner money is not included
            </p>
          </div>
          <p
            className={`text-2xl font-bold tabular-nums ${(kpis.net_profit || 0) >= 0 ? 'text-emerald-800' : 'text-rose-800'}`}
          >
            {currency(kpis.net_profit)}
          </p>
        </div>
      </button>

      <section>
        <div className="flex items-end justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold text-soul-blue">Treasury</h2>
            <p className="text-xs text-gray-500">
              Cash and bank. Instapay collections land in Bank EGP. Nothing enters until it is actually paid.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {treasury.map((t) => {
            const Icon = t.kind === 'cash' ? Banknote : Coins;
            return (
              <button
                key={t.code}
                type="button"
                onClick={() => onOpenTreasury(t.code)}
                className="rounded-2xl border border-soul-line bg-white p-5 text-left hover:border-soul-blue/40 hover:bg-soul-blue-50/40 transition-colors"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className={`w-11 h-11 rounded-2xl flex items-center justify-center text-white ${t.kind === 'cash' ? 'bg-emerald-600' : 'bg-soul-blue'}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className="text-[11px] font-mono text-gray-400">{t.currency}</span>
                </div>
                <p className="text-xs uppercase tracking-wider text-gray-400">
                  {t.kind === 'cash' ? 'Cash' : 'Bank'} · {t.currency}
                </p>
                <p className="font-semibold text-soul-blue mt-1 leading-snug">{t.name.replace(/^Bank - |^Cash - /, '')}</p>
                <p className="text-2xl font-bold tabular-nums mt-3">{currency(t.balance, t.currency)}</p>
                <p className="text-xs text-gray-500 mt-2">
                  In {currency(t.inflow, t.currency)} · Out {currency(t.outflow, t.currency)}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-soul-blue mb-1">Chart of accounts</h2>
        <p className="text-xs text-gray-500 mb-3">Open a book, then a sub-account. The log lives on the account page.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {groups.map((g) => {
            const meta = GROUP_META[g.id] || GROUP_META.assets;
            const Icon = meta.icon;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => onOpenGroup(g.id)}
                className="rounded-2xl border border-soul-line bg-white p-5 text-left hover:border-soul-blue/40 transition-colors"
              >
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 rounded-2xl ${meta.tile} text-white flex items-center justify-center flex-shrink-0`}>
                    <Icon className="w-6 h-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-soul-blue">{meta.label}</p>
                      <ChevronRight className="w-4 h-4 text-gray-300" />
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{meta.hint}</p>
                    <p className="text-xl font-bold tabular-nums mt-3">{currency(g.balance)}</p>
                    <p className="text-xs text-gray-400 mt-1">{g.account_count} sub-accounts</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <button
        type="button"
        onClick={() => onOpenTool('aging')}
        className="w-full rounded-2xl border border-amber-200 bg-amber-50/70 p-5 text-left hover:border-amber-300"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500 text-white flex items-center justify-center">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <p className="text-xs uppercase tracking-wider text-amber-800">Assets · Guest accounts receivable 105000</p>
            <p className="font-semibold text-soul-blue">Outstanding guest balances</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {outstanding.count} stays still owe Soul · this is AR, not revenue
            </p>
          </div>
          <p className="text-2xl font-bold tabular-nums text-amber-900">{currency(outstanding.amount)}</p>
        </div>
      </button>

      <section>
        <h2 className="text-lg font-semibold text-soul-blue mb-3">Workspace</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { id: 'owners', label: 'Owner payouts', icon: Users },
            { id: 'trust', label: 'Owner trust', icon: Building2 },
            { id: 'reports', label: 'Month-end reports', icon: FileSpreadsheet },
            { id: 'aging', label: 'AR aging', icon: AlertCircle },
            { id: 'close', label: 'Close month', icon: Lock },
            { id: 'gateway', label: 'Gateway settle', icon: CreditCard },
            { id: 'bank', label: 'Bank rec', icon: Landmark },
            { id: 'manual', label: 'Manual entries', icon: PenLine },
            { id: 'petty', label: 'Petty cash', icon: Wallet },
            { id: 'tax', label: 'Tax desk', icon: Scale },
            { id: 'recurring', label: 'Monthly charges', icon: Settings2 },
          ].map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onOpenTool(t.id)}
                className="rounded-2xl border border-soul-line bg-white px-4 py-4 text-left hover:bg-soul-blue-50/40"
              >
                <Icon className="w-5 h-5 text-soul-blue mb-2" />
                <p className="text-sm font-semibold">{t.label}</p>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function GroupView({ groupId, data, onOpenAccount }) {
  const meta = GROUP_META[groupId] || GROUP_META.assets;
  const group = (data?.groups || []).find((g) => g.id === groupId);
  const Icon = meta.icon;
  const accounts = group?.accounts || [];

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-soul-line bg-white p-6 flex items-center gap-4">
        <div className={`w-14 h-14 rounded-2xl ${meta.tile} text-white flex items-center justify-center`}>
          <Icon className="w-7 h-7" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-400">{groupId}</p>
          <h2 className="text-2xl font-semibold text-soul-blue">{meta.label}</h2>
          <p className="text-sm text-gray-500">{meta.hint} · {accounts.length} sub-accounts</p>
        </div>
        <p className="ml-auto text-2xl font-bold tabular-nums">{currency(group?.balance)}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {accounts.map((a) => (
          <button
            key={a.code}
            type="button"
            onClick={() => onOpenAccount(a.code)}
            className="rounded-2xl border border-soul-line bg-white p-5 text-left hover:border-soul-blue/40 transition-colors"
          >
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-xl ${meta.tint} flex items-center justify-center flex-shrink-0`}>
                <IconFor code={a.code} group={groupId} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-mono text-gray-400">{a.code}</p>
                <p className="font-semibold text-soul-blue leading-snug">{a.name}</p>
                {a.virtual ? (
                  <p className="text-[11px] text-amber-700 mt-1">Management view</p>
                ) : a.recurring ? (
                  <p className="text-[11px] text-violet-700 mt-1">Monthly auto-deduct</p>
                ) : null}
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300 mt-1" />
            </div>
            <div className="mt-4 flex items-end justify-between">
              <p className="text-xl font-bold tabular-nums">{currency(a.balance)}</p>
              <p className="text-xs text-gray-400">{a.txn_count} entries</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function AccountView({ code, fromDate, toDate, onOpenTxn }) {
  const params = rangeParams(fromDate, toDate);
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-account', code, params],
    queryFn: () => api.get(`/financial-system/accounts/${code}`, { params }).then((r) => r.data),
    enabled: Boolean(code),
  });

  if (isLoading) return <LoadingSpinner />;
  const account = data?.account || getAccount(code) || { code, name: code };
  const rows = data?.transactions || [];
  const meta = GROUP_META[account.group] || GROUP_META.assets;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-soul-line bg-white p-6">
        <div className="flex items-start gap-4">
          <div className={`w-14 h-14 rounded-2xl ${meta.tile} text-white flex items-center justify-center`}>
            <IconFor code={code} group={account.group} className="w-7 h-7" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-mono text-gray-400">{account.code}</p>
            <h2 className="text-2xl font-semibold text-soul-blue">{account.name}</h2>
            <p className="text-sm text-gray-500 capitalize">
              {ACCOUNT_GROUPS[account.group] || account.group}
              {account.virtual ? ' · management view' : ''}
              {account.recurring ? ' · monthly automatic' : ''}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">Balance</p>
            <p className="text-3xl font-bold tabular-nums text-soul-blue">{currency(account.balance)}</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
        <div className="px-6 py-4 border-b border-soul-line">
          <h3 className="font-semibold">Transaction log</h3>
          <p className="text-xs text-gray-500">Open a line to see how it moved between accounts</p>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">No movements in this period</p>
        ) : (
          <div className="divide-y divide-soul-line">
            {rows.map((row) => (
              <button
                key={`${row.id}-${row.side}`}
                type="button"
                onClick={() => onOpenTxn(row.id)}
                className="w-full px-6 py-3.5 flex items-center gap-4 text-left hover:bg-soul-blue-50/50"
              >
                <div className="w-24 shrink-0 text-xs text-gray-500">{formatDate(row.date)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{row.description}</p>
                  <p className="text-xs text-gray-400 truncate">{row.counterparty || row.type}</p>
                </div>
                <p className={`tabular-nums font-semibold ${row.side === 'debit' ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {row.side === 'debit' ? '+' : '−'}
                  {currency(row.amount)}
                </p>
                <ChevronRight className="w-4 h-4 text-gray-300" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TransactionView({ txnId, fromDate, toDate }) {
  const params = rangeParams(fromDate, toDate);
  const { data, isLoading, error } = useQuery({
    queryKey: ['financial-system-txn', txnId, params],
    queryFn: () =>
      api.get(`/financial-system/transactions/${encodeURIComponent(txnId)}`, { params }).then((r) => r.data),
    enabled: Boolean(txnId),
  });

  if (isLoading) return <LoadingSpinner />;
  if (error || !data) {
    return (
      <div className="rounded-2xl border border-soul-line bg-white p-10 text-center text-gray-500">
        This entry is not in the selected period.
      </div>
    );
  }

  const meta = data.meta || {};
  const flow = data.flow || {};

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-soul-line bg-white p-6">
        <p className="text-[11px] font-mono text-gray-400">{data.id}</p>
        <h2 className="text-2xl font-semibold text-soul-blue mt-1">{data.description}</h2>
        <div className="flex flex-wrap gap-2 mt-3">
          <span className="text-xs px-2 py-1 rounded-full bg-slate-100 capitalize">{data.type.replace('_', ' ')}</span>
          <span className="text-xs px-2 py-1 rounded-full bg-slate-100">{formatDate(data.date)}</span>
          <span className={`text-xs px-2 py-1 rounded-full ${data.balanced ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
            {data.balanced ? 'Balanced' : 'Check lines'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-center">
        <div className="rounded-2xl border border-rose-100 bg-rose-50/50 p-5">
          <p className="text-[11px] uppercase tracking-wider text-rose-700">From</p>
          <p className="font-mono text-xs text-gray-400 mt-2">{flow.from_account || '—'}</p>
          <p className="font-semibold text-soul-blue">{flow.from_name || '—'}</p>
        </div>
        <div className="flex flex-col items-center justify-center py-2">
          <ArrowRight className="w-8 h-8 text-soul-blue hidden md:block" />
          <p className="text-lg font-bold tabular-nums">{currency(data.debit || data.credit)}</p>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-5">
          <p className="text-[11px] uppercase tracking-wider text-emerald-700">To</p>
          <p className="font-mono text-xs text-gray-400 mt-2">{flow.to_account || '—'}</p>
          <p className="font-semibold text-soul-blue">{flow.to_name || '—'}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
        <div className="px-6 py-4 border-b font-semibold">Journal lines</div>
        <table className="table text-sm">
          <thead>
            <tr>
              <th>Account</th>
              <th>Memo</th>
              <th className="text-right">Debit</th>
              <th className="text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {(data.lines || []).map((line, i) => (
              <tr key={i}>
                <td>
                  <div className="font-mono text-[11px] text-gray-400">{line.account}</div>
                  <div className="font-medium">{line.account_name}</div>
                </td>
                <td className="text-gray-500">{line.memo}</td>
                <td className="text-right tabular-nums">{line.debit ? currency(line.debit) : '—'}</td>
                <td className="text-right tabular-nums">{line.credit ? currency(line.credit) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border border-soul-line bg-white p-6 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        {meta.guest_name && (
          <div>
            <p className="text-xs text-gray-400">Guest</p>
            <p className="font-medium">{meta.guest_name}</p>
          </div>
        )}
        {meta.unit_name && (
          <div>
            <p className="text-xs text-gray-400">Unit</p>
            <p className="font-medium">{meta.unit_name}{meta.project ? ` · ${meta.project}` : ''}</p>
          </div>
        )}
        {meta.payment_method && (
          <div>
            <p className="text-xs text-gray-400">Payment method</p>
            <p className="font-medium capitalize">{String(meta.payment_method).replace('_', ' ')}</p>
          </div>
        )}
        {meta.channel && (
          <div>
            <p className="text-xs text-gray-400">Channel</p>
            <p className="font-medium">{meta.channel}</p>
          </div>
        )}
        {meta.check_in && (
          <div>
            <p className="text-xs text-gray-400">Stay</p>
            <p className="font-medium">
              {formatDate(meta.check_in)} → {formatDate(meta.check_out)}
            </p>
          </div>
        )}
        {meta.total_amount != null && (
          <div>
            <p className="text-xs text-gray-400">Guest total / collected / outstanding</p>
            <p className="font-medium tabular-nums">
              {currency(meta.total_amount)} · {currency(meta.amount_paid)} · {currency(meta.outstanding)}
            </p>
          </div>
        )}
        {meta.automatic && (
          <div>
            <p className="text-xs text-gray-400">Posting</p>
            <p className="font-medium">Monthly automatic deduction</p>
          </div>
        )}
        {meta.notes && (
          <div className="sm:col-span-2">
            <p className="text-xs text-gray-400">Notes</p>
            <p>{meta.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function RecurringTool() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({
    queryKey: ['financial-system-recurring'],
    queryFn: () => api.get('/financial-system/recurring').then((r) => r.data),
  });
  const [drafts, setDrafts] = useState({});

  const save = useMutation({
    mutationFn: ({ kind, amount_egp, day_of_month }) =>
      api.put(`/financial-system/recurring/${kind}`, { amount_egp, day_of_month }),
    onSuccess: () => {
      toast.success('Monthly charge saved');
      qc.invalidateQueries({ queryKey: ['financial-system-recurring'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed'),
  });

  if (isLoading) return <LoadingSpinner />;

  const icons = { rent: Home, utilities: Zap, buffet: UtensilsCrossed };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Each month these accrue to vendor payable, then pay from Bank EGP. Rent and campus utilities pull 14/114 input VAT.
        Set 0 to skip a month. Owner money is computed from stays — it is not typed here.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(Array.isArray(data) ? data : []).map((row) => {
          const Icon = icons[row.kind] || Settings2;
          const draft = drafts[row.kind] || {
            amount_egp: row.amount_egp,
            day_of_month: row.day_of_month,
          };
          return (
            <div key={row.kind} className="rounded-2xl border border-soul-line bg-white p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-violet-50 text-violet-800 flex items-center justify-center">
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-semibold">{row.label}</p>
                  <p className="text-[11px] font-mono text-gray-400">{row.account_code}</p>
                </div>
              </div>
              <label className="label">Monthly amount (EGP)</label>
              <input
                type="number"
                min="0"
                className="input w-full mb-3"
                value={draft.amount_egp}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, [row.kind]: { ...draft, amount_egp: e.target.value } }))
                }
              />
              <label className="label">Day of month</label>
              <input
                type="number"
                min="1"
                max="28"
                className="input w-full mb-4"
                value={draft.day_of_month}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, [row.kind]: { ...draft, day_of_month: e.target.value } }))
                }
              />
              <button
                type="button"
                className="btn-primary w-full"
                disabled={save.isPending}
                onClick={() =>
                  save.mutate({
                    kind: row.kind,
                    amount_egp: draft.amount_egp,
                    day_of_month: draft.day_of_month,
                  })
                }
              >
                Save
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TaxTab({ rangeParams: params }) {
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-tax', params],
    queryFn: () => api.get('/financial-system/tax', { params }).then((r) => r.data),
  });
  if (isLoading) return <LoadingSpinner />;
  const liability = data?.liability || {};
  const vat = liability.output_vat || {};
  const wht = liability.withholding || {};
  const vatReturn = data?.vat_return || {};
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-amber-200 bg-white p-5">
          <p className="text-xs text-gray-500">Output VAT ({VAT_OUTPUT_PCT}% exclusive on commission + cleaning)</p>
          <p className="text-2xl font-bold mt-2 tabular-nums">{currency(vatReturn.output_vat ?? vat.vat_amount)}</p>
        </div>
        <div className="rounded-2xl border border-sky-200 bg-white p-5">
          <p className="text-xs text-gray-500">Input VAT (14/114 on rent, software, professional, utilities)</p>
          <p className="text-2xl font-bold mt-2 tabular-nums">{currency(vatReturn.input_vat)}</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-white p-5">
          <p className="text-xs text-gray-500">VAT return (output − input)</p>
          <p className="text-2xl font-bold mt-2 tabular-nums">{currency(vatReturn.net_vat_payable)}</p>
        </div>
        <div className="rounded-2xl border border-violet-200 bg-white p-5">
          <p className="text-xs text-gray-500">Withholding ({WHT_STANDARD_PCT}% / {WHT_REDUCED_PCT}% professional)</p>
          <p className="text-2xl font-bold mt-2 tabular-nums">{currency(wht.total_wht)}</p>
        </div>
      </div>
    </div>
  );
}

function OwnerStatementsTab({ fromDate, toDate, rangeParams: params }) {
  const [unitId, setUnitId] = useState('');
  const qc = useQueryClient();
  const { data: units = [] } = useQuery({
    queryKey: ['financial-system-units'],
    queryFn: () => api.get('/financial-system/units').then((r) => r.data),
  });
  const q = { ...params, unit_id: unitId || undefined };
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-owners', fromDate, toDate, unitId],
    queryFn: () => api.get('/financial-system/owner-statements', { params: q }).then((r) => r.data),
  });
  const settle = useMutation({
    mutationFn: (id) => api.post(`/financial-system/payouts/${id}/settle`),
    onSuccess: () => {
      toast.success('Payout marked settled');
      qc.invalidateQueries({ queryKey: ['financial-system-owners'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed'),
  });
  const reviewPayout = useMutation({
    mutationFn: ({ id, status }) => api.post(`/owner/payout-requests/${id}/review`, { status }),
    onSuccess: () => {
      toast.success('Payout updated');
      qc.invalidateQueries({ queryKey: ['financial-system-owners'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed'),
  });
  if (isLoading) return <LoadingSpinner />;
  const statements = data?.statements || [];
  const payouts = data?.payouts || [];
  return (
    <div className="space-y-6">
      <SearchableSelect
        className="w-72"
        value={unitId}
        onChange={setUnitId}
        placeholder="All units"
        options={[
          { value: '', label: 'All units' },
          ...units.map((u) => ({
            value: String(u.id),
            label: `${u.project ? `${u.project} — ` : ''}${u.unit_name}`,
          })),
        ]}
      />
      <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h3 className="font-semibold">Owner balances by unit</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="table text-sm">
            <thead>
              <tr>
                <th>Unit</th>
                <th>Owner</th>
                <th className="text-right">Credits</th>
                <th className="text-right">Maintenance</th>
                <th className="text-right">Net due</th>
              </tr>
            </thead>
            <tbody>
              {statements.map((s) => (
                <tr key={s.unit_id}>
                  <td className="font-medium">{s.unit_name}</td>
                  <td>{s.owner_names}</td>
                  <td className="text-right tabular-nums">{currency(s.gross_credits)}</td>
                  <td className="text-right tabular-nums text-rose-600">
                    {s.maintenance_deductions > 0 ? `−${currency(s.maintenance_deductions)}` : '—'}
                  </td>
                  <td className="text-right font-bold tabular-nums">{currency(s.net_payout_due)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
        <div className="px-6 py-4 border-b font-semibold">Withdrawal requests</div>
        <table className="table text-sm">
          <thead>
            <tr>
              <th>Owner</th>
              <th className="text-right">Amount</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {payouts.map((p) => (
              <tr key={p.id}>
                <td>{p.owner_name}</td>
                <td className="text-right tabular-nums">{currency(p.amount)}</td>
                <td className="capitalize">{p.status}</td>
                <td className="text-right space-x-2">
                  {p.status === 'requested' && (
                    <>
                      <button type="button" className="text-xs text-emerald-700" onClick={() => reviewPayout.mutate({ id: p.id, status: 'approved' })}>
                        Approve
                      </button>
                      <button type="button" className="text-xs text-red-600" onClick={() => reviewPayout.mutate({ id: p.id, status: 'rejected' })}>
                        Reject
                      </button>
                    </>
                  )}
                  {p.status === 'approved' && (
                    <button type="button" className="btn-secondary text-xs py-1 px-2" onClick={() => settle.mutate(p.id)}>
                      <CheckCircle2 className="w-3 h-3 inline mr-1" />
                      Mark settled
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ManualEntriesTab({ fromDate, toDate, rangeParams: params }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [form, setForm] = useState({
    entry_type: 'revenue',
    description: '',
    amount: '',
    entry_date: new Date().toISOString().slice(0, 10),
    notes: '',
    unit_id: '',
  });
  const { data: units = [] } = useQuery({
    queryKey: ['financial-system-units'],
    queryFn: () => api.get('/financial-system/units').then((r) => r.data),
  });
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-manual', fromDate, toDate],
    queryFn: () => api.get('/financial-system/manual-entries', { params }).then((r) => r.data),
  });
  const createEntry = useMutation({
    mutationFn: (payload) => api.post('/financial-system/manual-entries', payload),
    onSuccess: () => {
      toast.success('Entry added');
      qc.invalidateQueries({ queryKey: ['financial-system-manual'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
      setShowForm(false);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed'),
  });
  const removeEntry = useMutation({
    mutationFn: (id) => api.delete(`/financial-system/manual-entries/${id}`),
    onSuccess: () => {
      toast.success('Entry removed');
      qc.invalidateQueries({ queryKey: ['financial-system-manual'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
      setDeleteId(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed'),
  });
  if (isLoading) return <LoadingSpinner />;
  const entries = data?.entries || [];
  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <p className="text-sm text-gray-500">One-off lines that are not a booking and not a monthly charge.</p>
        <button type="button" className="btn-primary text-sm" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4" /> Add entry
        </button>
      </div>
      <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
        <table className="table text-sm">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Description</th>
              <th className="text-right">Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map((row) => (
              <tr key={row.id}>
                <td>{formatDate(row.entry_date)}</td>
                <td className="capitalize">{row.entry_type}</td>
                <td>{row.description}</td>
                <td className="text-right tabular-nums">{currency(row.amount)}</td>
                <td className="text-right">
                  <button type="button" className="p-1.5 text-gray-400 hover:text-rose-600" onClick={() => setDeleteId(row.id)}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title="Add entry"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            <button
              type="submit"
              form="manual-entry-form"
              className="btn-primary"
              disabled={createEntry.isPending}
            >
              Save
            </button>
          </>
        }
      >
        <form
          id="manual-entry-form"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            createEntry.mutate({
              entry_type: form.entry_type,
              description: form.description.trim(),
              amount: parseFloat(form.amount),
              entry_date: form.entry_date,
              notes: form.notes.trim() || undefined,
              unit_id: form.unit_id || undefined,
            });
          }}
        >
          <select className="input w-full" value={form.entry_type} onChange={(e) => setForm((f) => ({ ...f, entry_type: e.target.value }))}>
            <option value="revenue">Custom revenue</option>
            <option value="expense">Custom expense</option>
          </select>
          <input className="input w-full" placeholder="Description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} required />
          <input type="number" min="0.01" step="0.01" className="input w-full" placeholder="Amount" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} required />
          <input type="date" min={FINANCIAL_EPOCH} className="input w-full" value={form.entry_date} onChange={(e) => setForm((f) => ({ ...f, entry_date: e.target.value }))} />
          <SearchableSelect
            className="w-full"
            value={form.unit_id}
            onChange={(v) => setForm((f) => ({ ...f, unit_id: v }))}
            placeholder="Not linked to a unit"
            options={[
              { value: '', label: 'Not linked to a unit' },
              ...units.map((u) => ({ value: String(u.id), label: u.unit_name })),
            ]}
          />
        </form>
      </Modal>
      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Delete manual entry?"
        message="This removes the line from the books for this period."
        confirmText="Delete"
        danger
        onConfirm={() => removeEntry.mutate(deleteId)}
        loading={removeEntry.isPending}
      />
    </div>
  );
}

function AccountLines({ rows, amountKey = 'balance' }) {
  if (!rows?.length) return <p className="text-sm text-gray-400 py-6 text-center">No balances</p>;
  return (
    <table className="table text-sm">
      <thead>
        <tr>
          <th>Account</th>
          <th className="text-right">Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((a) => (
          <tr key={a.code}>
            <td>
              <span className="font-mono text-[11px] text-gray-400 mr-2">{a.code}</span>
              {a.name}
            </td>
            <td className="text-right tabular-nums">{currency(a[amountKey] ?? a.balance)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ReportsTool({ rangeParams: params }) {
  const [tab, setTab] = useState('pnl');
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-reports', params],
    queryFn: () => api.get('/financial-system/reports', { params }).then((r) => r.data),
  });
  if (isLoading) return <LoadingSpinner />;
  const pnl = data?.profit_and_loss || {};
  const tb = data?.trial_balance || {};
  const bs = data?.balance_sheet || {};
  const cf = data?.cash_flow || {};
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Soul-only statements from {data?.from_date} → {data?.to_date}. Owner trust sits on the balance sheet, not in profit.
      </p>
      <div className="flex flex-wrap gap-2">
        {[
          ['pnl', 'Profit & loss'],
          ['tb', 'Trial balance'],
          ['bs', 'Balance sheet'],
          ['cf', 'Cash flow'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`px-3 py-1.5 rounded-full text-sm ${tab === id ? 'bg-soul-blue text-white' : 'bg-white border border-soul-line'}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'pnl' && (
        <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
          <div className="px-6 py-4 border-b">
            <h3 className="font-semibold">Soul profit & loss</h3>
            <p className="text-xs text-gray-500">Commission, cleaning, markup, COGS, operating expenses</p>
          </div>
          <AccountLines rows={pnl.revenue} />
          <div className="px-6 py-2 bg-slate-50 text-sm flex justify-between">
            <span>Revenue</span>
            <span className="tabular-nums font-semibold">{currency(pnl.totals?.revenue)}</span>
          </div>
          <AccountLines rows={pnl.cogs} />
          <div className="px-6 py-2 bg-slate-50 text-sm flex justify-between">
            <span>Gross after direct costs</span>
            <span className="tabular-nums font-semibold">{currency(pnl.totals?.gross)}</span>
          </div>
          <AccountLines rows={pnl.opex} />
          <div className="px-6 py-3 bg-soul-blue text-white flex justify-between">
            <span>Net profit / loss</span>
            <span className="tabular-nums font-bold">{currency(pnl.totals?.net)}</span>
          </div>
        </div>
      )}
      {tab === 'tb' && (
        <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
          <table className="table text-sm">
            <thead>
              <tr>
                <th>Account</th>
                <th className="text-right">Debit</th>
                <th className="text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {(tb.rows || []).map((a) => (
                <tr key={a.code}>
                  <td>
                    <span className="font-mono text-[11px] text-gray-400 mr-2">{a.code}</span>
                    {a.name}
                  </td>
                  <td className="text-right tabular-nums">{a.debit ? currency(a.debit) : '—'}</td>
                  <td className="text-right tabular-nums">{a.credit ? currency(a.credit) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td>Total</td>
                <td className="text-right tabular-nums">{currency(tb.debit)}</td>
                <td className="text-right tabular-nums">{currency(tb.credit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {tab === 'bs' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
            <div className="px-6 py-3 border-b font-semibold">Assets</div>
            <AccountLines rows={bs.assets} />
            <div className="px-6 py-3 bg-slate-50 flex justify-between font-semibold">
              <span>Total assets</span>
              <span className="tabular-nums">{currency(bs.totals?.assets)}</span>
            </div>
          </div>
          <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
            <div className="px-6 py-3 border-b font-semibold">Liabilities & equity</div>
            <AccountLines rows={bs.liabilities} />
            <AccountLines rows={bs.equity} />
            <div className="px-6 py-3 bg-slate-50 flex justify-between font-semibold">
              <span>Liabilities + equity</span>
              <span className="tabular-nums">{currency(bs.totals?.liabilities_and_equity)}</span>
            </div>
          </div>
        </div>
      )}
      {tab === 'cf' && (
        <div className="rounded-2xl border border-soul-line bg-white p-6 space-y-3">
          <div className="flex justify-between text-sm">
            <span>Operating inflows</span>
            <span className="tabular-nums">{currency(cf.operating_in)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span>Operating outflows</span>
            <span className="tabular-nums">{currency(cf.operating_out)}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>Operating net</span>
            <span className="tabular-nums">{currency(cf.operating_net)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span>Owner payouts (financing)</span>
            <span className="tabular-nums">{currency(cf.financing_out)}</span>
          </div>
          <div className="flex justify-between text-lg font-bold text-soul-blue pt-2 border-t">
            <span>Net treasury change</span>
            <span className="tabular-nums">{currency(cf.net_change)}</span>
          </div>
          <p className="text-xs text-gray-500">{cf.note}</p>
        </div>
      )}
    </div>
  );
}

function AgingTool({ rangeParams: params, onOpenAccount }) {
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-aging', params],
    queryFn: () => api.get('/financial-system/aging', { params }).then((r) => r.data),
  });
  if (isLoading) return <LoadingSpinner />;
  const buckets = data?.buckets || {};
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-gray-500">
          Guest invoices aged from check-in. Book balance on 105000 is {currency(data?.ar_balance)}.
        </p>
        <button type="button" className="btn-secondary text-sm" onClick={() => onOpenAccount('105000')}>
          Open 105000
        </button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Object.entries(buckets).map(([key, b]) => (
          <div key={key} className="rounded-2xl border border-soul-line bg-white p-4">
            <p className="text-xs text-gray-400">{b.label}</p>
            <p className="text-xl font-bold tabular-nums mt-1">{currency(b.amount)}</p>
            <p className="text-xs text-gray-500">{b.count} stays</p>
          </div>
        ))}
      </div>
      {Object.values(buckets).map((b) =>
        (b.rows || []).length ? (
          <div key={b.label} className="rounded-2xl border border-soul-line bg-white overflow-hidden">
            <div className="px-6 py-3 border-b font-semibold">{b.label}</div>
            <table className="table text-sm">
              <thead>
                <tr>
                  <th>Guest</th>
                  <th>Unit</th>
                  <th>Check-in</th>
                  <th className="text-right">Days</th>
                  <th className="text-right">Due</th>
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r) => (
                  <tr key={r.reservation_id}>
                    <td>{r.guest_name}</td>
                    <td>{r.unit_name}</td>
                    <td>{formatDate(r.check_in)}</td>
                    <td className="text-right tabular-nums">{r.days}</td>
                    <td className="text-right tabular-nums font-medium">{currency(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null
      )}
    </div>
  );
}

function CloseTool({ toDate }) {
  const qc = useQueryClient();
  const defaultMonth = (toDate || new Date().toISOString().slice(0, 10)).slice(0, 7);
  const [month, setMonth] = useState(defaultMonth);
  const { data = [], isLoading } = useQuery({
    queryKey: ['financial-system-periods'],
    queryFn: () => api.get('/financial-system/periods').then((r) => r.data),
  });
  const close = useMutation({
    mutationFn: (yearMonth) => api.post(`/financial-system/periods/${yearMonth}/close`),
    onSuccess: () => {
      toast.success('Month closed');
      qc.invalidateQueries({ queryKey: ['financial-system-periods'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
      qc.invalidateQueries({ queryKey: ['financial-system-reports'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed'),
  });
  const reopen = useMutation({
    mutationFn: (yearMonth) => api.delete(`/financial-system/periods/${yearMonth}/close`),
    onSuccess: () => {
      toast.success('Month reopened');
      qc.invalidateQueries({ queryKey: ['financial-system-periods'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed'),
  });
  if (isLoading) return <LoadingSpinner />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Closing zeros Soul revenue and expense into retained earnings (302000) and locks manual entries for that month.
      </p>
      <div className="rounded-2xl border border-soul-line bg-white p-5 flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Month</label>
          <input type="month" className="input" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <button type="button" className="btn-primary" disabled={close.isPending} onClick={() => close.mutate(month)}>
          <Lock className="w-4 h-4" /> Close month
        </button>
      </div>
      <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
        <table className="table text-sm">
          <thead>
            <tr>
              <th>Month</th>
              <th className="text-right">P&amp;L transferred</th>
              <th>Closed by</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(Array.isArray(data) ? data : []).map((row) => (
              <tr key={row.year_month}>
                <td className="font-medium">{row.year_month}</td>
                <td className="text-right tabular-nums">{currency(row.pnl_amount)}</td>
                <td>{row.closed_by_name || '—'}</td>
                <td className="text-right">
                  <button type="button" className="text-xs text-amber-700 inline-flex items-center gap-1" onClick={() => reopen.mutate(row.year_month)}>
                    <Unlock className="w-3 h-3" /> Reopen
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GatewayTool({ rangeParams: params }) {
  const qc = useQueryClient();
  const [mdr, setMdr] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-gateway', params],
    queryFn: () => api.get('/financial-system/gateway', { params }).then((r) => r.data),
  });
  const save = useMutation({
    mutationFn: (value_num) => api.put('/financial-system/settings/gateway_mdr_pct', { value_num }),
    onSuccess: () => {
      toast.success('MDR saved');
      qc.invalidateQueries({ queryKey: ['financial-system-gateway'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed'),
  });
  if (isLoading) return <LoadingSpinner />;
  const pct = mdr === '' ? data?.mdr_pct : mdr;
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Card / Paymob collections sit on 106000, then settle to Bank EGP net of merchant discount.
      </p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ['Clearing in', data?.clearing_in],
          ['Settled to bank', data?.settled_net],
          ['MDR expense', data?.mdr_expense],
          ['Still uncleared', data?.uncleared],
        ].map(([label, amt]) => (
          <div key={label} className="rounded-2xl border border-soul-line bg-white p-4">
            <p className="text-xs text-gray-400">{label}</p>
            <p className="text-xl font-bold tabular-nums mt-1">{currency(amt)}</p>
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-soul-line bg-white p-5 flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Gateway MDR %</label>
          <input type="number" min="0" step="0.1" className="input w-32" value={pct} onChange={(e) => setMdr(e.target.value)} />
        </div>
        <button type="button" className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(pct)}>
          Save MDR
        </button>
      </div>
    </div>
  );
}

function BankRecTool({ rangeParams: params }) {
  const qc = useQueryClient();
  const [account, setAccount] = useState('101000');
  const [snap, setSnap] = useState({ statement_date: new Date().toISOString().slice(0, 10), statement_balance: '' });
  const q = { ...params, account };
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-bank', q],
    queryFn: () => api.get('/financial-system/bank-rec', { params: q }).then((r) => r.data),
  });
  const toggle = useMutation({
    mutationFn: (row) => api.post('/financial-system/bank-rec/toggle', { entry_id: row.id, account_code: account }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['financial-system-bank'] }),
  });
  const saveSnap = useMutation({
    mutationFn: () =>
      api.post('/financial-system/bank-rec/snapshot', {
        account_code: account,
        statement_date: snap.statement_date,
        statement_balance: parseFloat(snap.statement_balance),
      }),
    onSuccess: () => {
      toast.success('Statement saved');
      qc.invalidateQueries({ queryKey: ['financial-system-bank'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed'),
  });
  if (isLoading) return <LoadingSpinner />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {['101000', '102000', '103000', '104000'].map((code) => (
          <button
            key={code}
            type="button"
            className={`px-3 py-1.5 rounded-full text-sm ${account === code ? 'bg-soul-blue text-white' : 'bg-white border'}`}
            onClick={() => setAccount(code)}
          >
            {code}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-2xl border bg-white p-4">
          <p className="text-xs text-gray-400">Book balance</p>
          <p className="text-xl font-bold tabular-nums">{currency(data?.account?.balance)}</p>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <p className="text-xs text-gray-400">Unreconciled movement</p>
          <p className="text-xl font-bold tabular-nums">{currency(data?.unreconciled)}</p>
        </div>
        <div className="rounded-2xl border bg-white p-4 space-y-2">
          <p className="text-xs text-gray-400">Bank statement snapshot</p>
          <input type="date" className="input w-full" value={snap.statement_date} onChange={(e) => setSnap((s) => ({ ...s, statement_date: e.target.value }))} />
          <input type="number" className="input w-full" placeholder="Statement balance" value={snap.statement_balance} onChange={(e) => setSnap((s) => ({ ...s, statement_balance: e.target.value }))} />
          <button type="button" className="btn-secondary w-full text-sm" onClick={() => saveSnap.mutate()}>Save snapshot</button>
        </div>
      </div>
      <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
        <table className="table text-sm">
          <thead>
            <tr>
              <th />
              <th>Date</th>
              <th>Description</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(data?.lines || []).map((row) => (
              <tr key={`${row.id}-${row.side}`} className={row.reconciled ? 'bg-emerald-50/40' : ''}>
                <td>
                  <input type="checkbox" checked={Boolean(row.reconciled)} onChange={() => toggle.mutate(row)} />
                </td>
                <td>{formatDate(row.date)}</td>
                <td>{row.description}</td>
                <td className="text-right tabular-nums">
                  {row.side === 'debit' ? '+' : '−'}
                  {currency(row.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OwnerTrustTool({ rangeParams: params }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ owner_id: '', amount: '', reason: '' });
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-trust', params],
    queryFn: () => api.get('/financial-system/owner-trust', { params }).then((r) => r.data),
  });
  const { data: owners = [] } = useQuery({
    queryKey: ['users-owners'],
    queryFn: () => api.get('/users/owners').then((r) => r.data),
  });
  const addHb = useMutation({
    mutationFn: (payload) => api.post('/financial-system/holdbacks', payload),
    onSuccess: () => {
      toast.success('Holdback recorded');
      qc.invalidateQueries({ queryKey: ['financial-system-trust'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed'),
  });
  const release = useMutation({
    mutationFn: (id) => api.post(`/financial-system/holdbacks/${id}/release`),
    onSuccess: () => {
      toast.success('Holdback released');
      qc.invalidateQueries({ queryKey: ['financial-system-trust'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
    },
  });
  if (isLoading) return <LoadingSpinner />;
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-soul-line bg-white p-5 flex flex-wrap gap-6">
        <div>
          <p className="text-xs text-gray-400">Control account 202000</p>
          <p className="text-2xl font-bold tabular-nums">{currency(data?.control_202000)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Sub-ledger tied</p>
          <p className="text-2xl font-bold">{data?.tied ? 'Yes' : 'Check'}</p>
        </div>
      </div>
      <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
        <div className="px-6 py-3 border-b font-semibold">Owner trust sub-ledger</div>
        <table className="table text-sm">
          <thead>
            <tr>
              <th>Owner</th>
              <th className="text-right">Credits</th>
              <th className="text-right">Payouts</th>
              <th className="text-right">Holdbacks</th>
              <th className="text-right">Charges</th>
              <th className="text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {(data?.owners || []).map((o) => (
              <tr key={o.owner_id || o.owner_name}>
                <td>{o.owner_name}</td>
                <td className="text-right tabular-nums">{currency(o.credits)}</td>
                <td className="text-right tabular-nums">{currency(o.payouts)}</td>
                <td className="text-right tabular-nums">{currency(o.holdbacks)}</td>
                <td className="text-right tabular-nums">{currency(o.expenses)}</td>
                <td className="text-right tabular-nums font-bold">{currency(o.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rounded-2xl border border-soul-line bg-white p-5 space-y-3">
        <h3 className="font-semibold">Hold back from an owner</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <SearchableSelect
            className="w-full"
            value={form.owner_id}
            onChange={(v) => setForm((f) => ({ ...f, owner_id: v }))}
            placeholder="Owner"
            options={(Array.isArray(owners) ? owners : []).map((o) => ({
              value: String(o.id),
              label: o.full_name || o.name,
            }))}
          />
          <input type="number" className="input" placeholder="Amount" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
          <input className="input" placeholder="Reason" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
          <button
            type="button"
            className="btn-primary"
            disabled={addHb.isPending}
            onClick={() => addHb.mutate({ owner_id: parseInt(form.owner_id, 10), amount: parseFloat(form.amount), reason: form.reason })}
          >
            Hold back
          </button>
        </div>
        <table className="table text-sm">
          <thead>
            <tr>
              <th>Owner</th>
              <th className="text-right">Amount</th>
              <th>Reason</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(data?.holdbacks || []).map((h) => (
              <tr key={h.id}>
                <td>{h.owner_name}</td>
                <td className="text-right tabular-nums">{currency(h.amount)}</td>
                <td>{h.reason || '—'} {Number(h.is_released) === 1 ? '(released)' : ''}</td>
                <td className="text-right">
                  {Number(h.is_released) !== 1 && (
                    <button type="button" className="text-xs text-emerald-700" onClick={() => release.mutate(h.id)}>
                      Release
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function FinancialSystem() {
  const { view, group, code, txn, tool, go } = useFinanceNav();
  const [fromDate, setFromDate] = useState(FINANCIAL_EPOCH);
  const [toDate, setToDate] = useState('');
  const [exporting, setExporting] = useState(false);
  const params = rangeParams(fromDate, toDate);

  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-portal', fromDate, toDate],
    queryFn: () => api.get('/financial-system/portal', { params }).then((r) => r.data),
    refetchInterval: 60_000,
  });

  async function exportReport() {
    try {
      setExporting(true);
      const res = await api.get('/financial-system/export', { params, responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'soul-financial-system.xlsx';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  }

  const crumbs = useMemo(() => {
    const items = [{ label: 'Financial System', onClick: () => go({ view: 'home', group: '', code: '', txn: '', tool: '' }) }];
    if (tool) {
      const labels = {
        owners: 'Owner payouts',
        trust: 'Owner trust',
        manual: 'Manual entries',
        petty: 'Petty cash',
        tax: 'Tax desk',
        recurring: 'Monthly charges',
        reports: 'Month-end reports',
        aging: 'AR aging',
        close: 'Close month',
        gateway: 'Gateway settle',
        bank: 'Bank rec',
      };
      items.push({ label: labels[tool] || tool });
      return items;
    }
    if (group) items.push({ label: GROUP_META[group]?.label || group, onClick: () => go({ view: 'group', group, code: '', txn: '', tool: '' }) });
    if (code) items.push({ label: getAccount(code)?.name || code, onClick: () => go({ view: 'account', group: getAccount(code)?.group || group, code, txn: '', tool: '' }) });
    if (txn) items.push({ label: txn });
    return items;
  }, [tool, group, code, txn]);

  const showHome = view === 'home' && !tool && !code && !txn;
  const showGroup = view === 'group' && group && !code && !txn && !tool;
  const showAccount = Boolean(code) && !txn && !tool;
  const showTxn = Boolean(txn) && !tool;

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-gray-400 mb-1">Soul books</p>
          <h1 className="page-title flex items-center gap-2">
            <Landmark className="w-7 h-7 text-soul-blue" />
            Financial System
          </h1>
          <nav className="flex flex-wrap items-center gap-1 text-sm mt-2">
            {crumbs.map((c, i) => (
              <span key={`${c.label}-${i}`} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-gray-300" />}
                {c.onClick ? (
                  <button type="button" className="text-soul-blue hover:underline" onClick={c.onClick}>
                    {c.label}
                  </button>
                ) : (
                  <span className="text-gray-500">{c.label}</span>
                )}
              </span>
            ))}
          </nav>
        </div>
        <DateFilters fromDate={fromDate} toDate={toDate} onFrom={setFromDate} onTo={setToDate} />
      </div>

      {!showHome && (
        <button
          type="button"
          className="text-sm text-soul-blue inline-flex items-center gap-1"
          onClick={() => {
            if (txn) return go({ view: 'account', txn: '', code: code || getAccount(code)?.code, group });
            if (code) return go({ view: 'group', code: '', txn: '', group: getAccount(code)?.group || group });
            if (tool) return go({ view: 'home', tool: '', group: '', code: '', txn: '' });
            go({ view: 'home', group: '', code: '', txn: '', tool: '' });
          }}
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
      )}

      {isLoading && showHome ? (
        <LoadingSpinner />
      ) : showHome ? (
        <HomeView
          data={data}
          onOpenGroup={(id) => go({ view: 'group', group: id, code: '', txn: '', tool: '' })}
          onOpenAccount={(c) => go({ view: 'account', code: c, group: getAccount(c)?.group || '', txn: '', tool: '' })}
          onOpenTreasury={(c) => go({ view: 'account', code: c, group: 'assets', txn: '', tool: '' })}
          onOpenTool={(id) => go({ view: 'tool', tool: id, group: '', code: '', txn: '' })}
          onExport={exportReport}
          exporting={exporting}
        />
      ) : showTxn ? (
        <TransactionView txnId={txn} fromDate={fromDate} toDate={toDate} />
      ) : showAccount ? (
        <AccountView
          code={code}
          fromDate={fromDate}
          toDate={toDate}
          onOpenTxn={(id) => go({ view: 'txn', txn: id, code, group: getAccount(code)?.group || group })}
        />
      ) : showGroup ? (
        <GroupView
          groupId={group}
          data={data}
          onOpenAccount={(c) => go({ view: 'account', code: c, group, txn: '', tool: '' })}
        />
      ) : tool === 'tax' ? (
        <TaxTab rangeParams={params} />
      ) : tool === 'owners' ? (
        <OwnerStatementsTab fromDate={fromDate} toDate={toDate} rangeParams={params} />
      ) : tool === 'trust' ? (
        <OwnerTrustTool rangeParams={params} />
      ) : tool === 'reports' ? (
        <ReportsTool rangeParams={params} />
      ) : tool === 'aging' ? (
        <AgingTool
          rangeParams={params}
          onOpenAccount={(c) => go({ view: 'account', code: c, group: 'assets', txn: '', tool: '' })}
        />
      ) : tool === 'close' ? (
        <CloseTool toDate={toDate} />
      ) : tool === 'gateway' ? (
        <GatewayTool rangeParams={params} />
      ) : tool === 'bank' ? (
        <BankRecTool rangeParams={params} />
      ) : tool === 'manual' ? (
        <ManualEntriesTab fromDate={fromDate} toDate={toDate} rangeParams={params} />
      ) : tool === 'petty' ? (
        <PettyCashSection embedded />
      ) : tool === 'recurring' ? (
        <RecurringTool />
      ) : (
        <LoadingSpinner />
      )}
    </div>
  );
}
