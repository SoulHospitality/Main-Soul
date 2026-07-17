import { useMemo, useState } from 'react';
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
    </div>
  );
}
