import { useMemo, useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { DollarSign, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import SearchableSelect from '../components/ui/SearchableSelect';

const localISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return localISO(new Date(y, m - 1, d + n));
}

function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const startPad = (first.getDay() + 6) % 7; // Mon-first
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(localISO(new Date(year, month, d)));
  return cells;
}

export default function Pricing() {
  const qc = useQueryClient();
  const today = localISO(new Date());
  const [unitId, setUnitId] = useState('');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 29));
  const [price, setPrice] = useState('');
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() };
  });

  const { data: units = [], isLoading: unitsLoading } = useQuery({
    queryKey: ['units-pricing'],
    queryFn: () => api.get('/units').then((r) => r.data),
  });

  const horizonFrom = localISO(new Date(cursor.y, cursor.m, 1));
  const horizonTo = localISO(new Date(cursor.y, cursor.m + 2, 0));

  const { data: prices = [], isLoading: pricesLoading } = useQuery({
    queryKey: ['daily-prices-unit', unitId, horizonFrom, horizonTo],
    enabled: !!unitId,
    queryFn: () =>
      api
        .get(`/daily-prices/${unitId}`)
        .then((r) => (Array.isArray(r.data) ? r.data : []))
        .catch(() =>
          api
            .get('/daily-prices', { params: { from_date: horizonFrom, to_date: horizonTo } })
            .then((res) => (res.data || []).filter((p) => String(p.unit_id) === String(unitId)))
        ),
  });

  const priceMap = useMemo(() => {
    const m = {};
    for (const p of prices) {
      if (unitId && p.unit_id && String(p.unit_id) !== String(unitId)) continue;
      m[String(p.date).slice(0, 10)] = Number(p.price);
    }
    return m;
  }, [prices, unitId]);

  const saveMutation = useMutation({
    mutationFn: ({ clear }) =>
      api.post('/daily-prices/batch', {
        unit_id: unitId,
        from_date: from,
        to_date: to,
        price: clear ? null : Number(price),
        clear: !!clear,
      }),
    onSuccess: (_, vars) => {
      toast.success(vars.clear ? 'Prices cleared' : 'Prices saved');
      qc.invalidateQueries({ queryKey: ['daily-prices-unit'] });
      qc.invalidateQueries({ queryKey: ['daily-prices'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to save'),
  });

  const cells = monthGrid(cursor.y, cursor.m);
  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">Nightly pricing</h1>
        <p className="page-subtitle">
          Daily prices are the only bookable rates. Unpriced nights are unavailable on the website.
        </p>
      </div>

      <div className="card p-5 space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label">Unit</label>
            {unitsLoading ? (
              <LoadingSpinner />
            ) : (
              <SearchableSelect
                value={unitId}
                onChange={setUnitId}
                placeholder="Select unit…"
                options={[
                  { value: '', label: 'Select unit…' },
                  ...units.map((u) => ({
                    value: String(u.id),
                    label: `${u.unit_number || u.slug || ''} — ${u.name || u.title}`,
                  })),
                ]}
              />
            )}
          </div>
          <div className="flex items-end gap-2 text-sm text-gray-500">
            <Link to="/admin/schedule" className="text-primary-600 hover:underline">
              Open schedule calendar
            </Link>
          </div>
        </div>

        <div className="grid sm:grid-cols-4 gap-3">
          <div>
            <label className="label">From</label>
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className="label">Nightly price (EGP)</label>
            <input
              type="number"
              min="1"
              className="input"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="e.g. 4500"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              type="button"
              disabled={!unitId || !from || !to || !price || saveMutation.isPending}
              onClick={() => saveMutation.mutate({ clear: false })}
              className="btn-primary flex-1"
            >
              <DollarSign className="w-4 h-4" />
              Set range
            </button>
            <button
              type="button"
              disabled={!unitId || !from || !to || saveMutation.isPending}
              onClick={() => saveMutation.mutate({ clear: true })}
              className="btn-secondary"
              title="Clear prices (blocks booking)"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {unitId && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">{monthLabel}</h2>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  setCursor((c) => {
                    const d = new Date(c.y, c.m - 1, 1);
                    return { y: d.getFullYear(), m: d.getMonth() };
                  })
                }
              >
                Prev
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  setCursor((c) => {
                    const d = new Date(c.y, c.m + 1, 1);
                    return { y: d.getFullYear(), m: d.getMonth() };
                  })
                }
              >
                Next
              </button>
            </div>
          </div>
          {pricesLoading ? (
            <LoadingSpinner />
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-500 mb-2">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                  <div key={d}>{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {cells.map((iso, idx) => {
                  if (!iso) return <div key={`e-${idx}`} />;
                  const p = priceMap[iso];
                  return (
                    <button
                      key={iso}
                      type="button"
                      onClick={() => {
                        setFrom(iso);
                        setTo(iso);
                        if (p) setPrice(String(p));
                      }}
                      className={`min-h-[64px] rounded-lg border p-1.5 text-left transition-colors ${
                        p
                          ? 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100'
                          : 'border-gray-100 bg-gray-50 text-gray-400 hover:bg-gray-100'
                      }`}
                    >
                      <div className="text-xs font-medium">{Number(iso.slice(8))}</div>
                      <div className="text-[11px] mt-1">{p ? `${p >= 1000 ? `${(p / 1000).toFixed(1)}k` : p}` : '—'}</div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {unitId && (
        <PricingRecommendationsPanel unitId={unitId} />
      )}
    </div>
  );
}

function PricingRecommendationsPanel({ unitId }) {
  const qc = useQueryClient();
  const [base, setBase] = useState('');
  const [floor, setFloor] = useState('');
  const [ceiling, setCeiling] = useState('');
  const [confidence, setConfidence] = useState('0.7');
  const [reasoning, setReasoning] = useState('');
  const [comparable, setComparable] = useState(false);

  const { data: unitMeta } = useQuery({
    queryKey: ['unit-meta', unitId],
    queryFn: () => api.get(`/units`).then((r) => {
      const list = Array.isArray(r.data) ? r.data : r.data?.items || [];
      return list.find((u) => String(u.id) === String(unitId));
    }),
  });

  useEffect(() => {
    if (unitMeta) setComparable(Boolean(unitMeta.is_comparable));
  }, [unitMeta]);

  const { data: recs = [] } = useQuery({
    queryKey: ['pricing-recommendations', unitId],
    queryFn: () =>
      api.get('/pricing-recommendations', { params: { unit_id: unitId } }).then((r) => r.data),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post('/pricing-recommendations', {
        unit_id: unitId,
        base_price: Number(base) || null,
        floor_price: floor === '' ? null : Number(floor),
        ceiling_price: ceiling === '' ? null : Number(ceiling),
        confidence: Number(confidence) || 0,
        reasoning: { summary: reasoning || 'Manual recommendation' },
        status: 'draft',
      }),
    onSuccess: () => {
      toast.success('Recommendation saved');
      setBase('');
      qc.invalidateQueries({ queryKey: ['pricing-recommendations', unitId] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const generate = useMutation({
    mutationFn: () => api.post('/pricing-recommendations/generate', { unit_id: unitId }),
    onSuccess: (r) => {
      toast.success(`Generated · confidence ${r.data.confidence}`);
      qc.invalidateQueries({ queryKey: ['pricing-recommendations', unitId] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Generate failed'),
  });

  const patchRec = useMutation({
    mutationFn: ({ id, status, body }) => api.patch(`/pricing-recommendations/${id}`, { status, ...body }),
    onSuccess: (_, v) => {
      toast.success(v.status === 'accepted' ? 'Accepted · daily prices seeded' : `Status → ${v.status}`);
      qc.invalidateQueries({ queryKey: ['pricing-recommendations', unitId] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const toggleComp = useMutation({
    mutationFn: (flag) => api.patch(`/units/${unitId}/comparable`, { is_comparable: flag }),
    onSuccess: (r) => {
      setComparable(Boolean(r.data.is_comparable));
      toast.success(r.data.is_comparable ? 'Marked as comparable' : 'Unmarked comparable');
      qc.invalidateQueries({ queryKey: ['unit-meta', unitId] });
    },
  });

  const parseReason = (r) => {
    if (!r?.reasoning) return {};
    return typeof r.reasoning === 'string' ? JSON.parse(r.reasoning) : r.reasoning;
  };

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-gray-900">Pricing recommendations</h3>
          <p className="text-xs text-gray-500">
            Rules engine: curated/peer comps + weekday/weekend/peak · negotiate floor–ceiling
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <label className="text-xs flex items-center gap-1.5 text-gray-600">
            <input
              type="checkbox"
              checked={comparable}
              onChange={(e) => toggleComp.mutate(e.target.checked)}
            />
            Use as comparable
          </label>
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={generate.isPending}
            onClick={() => generate.mutate()}
          >
            Auto-generate
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="text-xs text-gray-500">Base</label>
          <input className="block border rounded-lg px-3 py-2 text-sm w-28" value={base} onChange={(e) => setBase(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-gray-500">Floor</label>
          <input className="block border rounded-lg px-3 py-2 text-sm w-28" value={floor} onChange={(e) => setFloor(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-gray-500">Ceiling</label>
          <input className="block border rounded-lg px-3 py-2 text-sm w-28" value={ceiling} onChange={(e) => setCeiling(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-gray-500">Confidence</label>
          <input className="block border rounded-lg px-3 py-2 text-sm w-20" value={confidence} onChange={(e) => setConfidence(e.target.value)} />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="text-xs text-gray-500">Reasoning</label>
          <input className="block w-full border rounded-lg px-3 py-2 text-sm" value={reasoning} onChange={(e) => setReasoning(e.target.value)} />
        </div>
        <button type="button" className="btn-secondary text-sm" onClick={() => create.mutate()} disabled={!base}>
          Save draft
        </button>
      </div>
      <ul className="text-sm divide-y border rounded-lg">
        {recs.map((r) => {
          const reason = parseReason(r);
          return (
            <li key={r.id} className="px-3 py-3 space-y-1">
              <div className="flex justify-between gap-3 flex-wrap">
                <span className="font-medium">
                  Base {r.base_price ?? '—'} · floor {r.floor_price ?? '—'} · ceil {r.ceiling_price ?? '—'} · wknd{' '}
                  {r.weekend_price ?? '—'} · peak {r.peak_price ?? '—'}
                </span>
                <span className="text-xs text-gray-400">
                  conf {Math.round(Number(r.confidence || 0) * 100)}% · {r.status}
                </span>
              </div>
              {reason.summary && <p className="text-xs text-gray-500">{reason.summary}</p>}
              {(reason.comparable_titles || []).length > 0 && (
                <p className="text-xs text-gray-400">Comps: {reason.comparable_titles.slice(0, 6).join(', ')}</p>
              )}
              {r.status !== 'accepted' && r.status !== 'rejected' && r.status !== 'superseded' && (
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    className="text-xs text-emerald-700 font-medium"
                    onClick={() => patchRec.mutate({ id: r.id, status: 'accepted' })}
                  >
                    Accept & seed 60d
                  </button>
                  <button
                    type="button"
                    className="text-xs text-red-600 font-medium"
                    onClick={() => patchRec.mutate({ id: r.id, status: 'rejected' })}
                  >
                    Reject
                  </button>
                </div>
              )}
            </li>
          );
        })}
        {!recs.length && <li className="px-3 py-4 text-gray-400 text-center text-xs">No recommendations yet</li>}
      </ul>
    </div>
  );
}
