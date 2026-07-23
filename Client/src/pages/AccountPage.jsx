import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import { useAuth } from '../context/AuthContext';
import api from '../api/http';
import ListingCard from '../components/ListingCard';
import { getListingWpId, useWishlist } from '../hooks/useWishlist';

const HOUSEKEEPING_TIMES = (() => {
  const out = [];
  for (let h = 3; h <= 23; h++) {
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    const suffix = h < 12 ? 'AM' : 'PM';
    out.push(`${hour12}:00 ${suffix}`);
  }
  return out;
})();

function datesInStay(checkin, checkout) {
  const out = [];
  if (!checkin || !checkout) return out;
  const start = new Date(`${String(checkin).slice(0, 10)}T00:00:00`);
  const end = new Date(`${String(checkout).slice(0, 10)}T00:00:00`);
  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

function money(n) {
  return Number(n || 0).toLocaleString('en-EG');
}

export default function AccountPage() {
  const { user, signOut } = useAuth();
  const [trips, setTrips] = useState([]);
  const [points, setPoints] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hkBookingId, setHkBookingId] = useState(null);
  const [hkDate, setHkDate] = useState('');
  const [hkTime, setHkTime] = useState('10:00 AM');
  const [hkBusy, setHkBusy] = useState(false);
  const [hkMsg, setHkMsg] = useState(null);

  async function refresh() {
    if (!user) return;
    setLoading(true);
    try {
      const [tripsRes, meRes] = await Promise.all([
        api.get('/bookings/mine'),
        api.get('/auth/me'),
      ]);
      setTrips(tripsRes.data.items || []);
      setPoints(Number(meRes.data?.profile?.soul_points) || 0);
    } catch {
      setTrips([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [user]);

  const activeStay = useMemo(
    () => trips.find((t) => t.is_current_stay && t.status === 'confirmed'),
    [trips]
  );

  const stayDates = useMemo(
    () => datesInStay(activeStay?.checkin, activeStay?.checkout),
    [activeStay]
  );

  useEffect(() => {
    if (activeStay) {
      setHkBookingId(activeStay.id);
      const today = new Date();
      const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      setHkDate(stayDates.includes(todayIso) ? todayIso : stayDates[0] || '');
    } else {
      setHkBookingId(null);
    }
  }, [activeStay, stayDates]);

  async function requestHousekeeping(e) {
    e.preventDefault();
    if (!hkBookingId || !hkDate || !hkTime || hkBusy) return;
    setHkBusy(true);
    setHkMsg(null);
    try {
      await api.post(`/bookings/${hkBookingId}/housekeeping-request`, {
        date: hkDate,
        time: hkTime,
      });
      setHkMsg({ type: 'success', text: 'Housekeeping requested. Our team will follow up.' });
      await refresh();
    } catch (err) {
      setHkMsg({
        type: 'error',
        text: err.response?.data?.error || err.message || 'Could not send request',
      });
    } finally {
      setHkBusy(false);
    }
  }

  if (!user) {
    return (
      <div>
        <Header />
        <main className="mx-auto max-w-md px-5 py-20 text-center">
          <h1 className="font-display text-3xl">Account</h1>
          <Link
            to="/sign-in"
            className="mt-6 inline-block rounded-full bg-soul-blue px-5 py-2 text-white"
          >
            Sign in
          </Link>
        </main>
        <Footer />
      </div>
    );
  }

  const displayName = user.full_name || user.email || 'Guest';

  return (
    <div>
      <Header />
      <main className="mx-auto max-w-soul px-5 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-soul-muted">
              Your account
            </p>
            <h1 className="mt-2 font-display text-4xl text-soul-blue">Hello, {displayName}</h1>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="rounded-full border border-soul-line px-5 py-2.5 text-sm font-semibold text-soul-blue transition hover:bg-soul-blue hover:text-white"
          >
            Logout
          </button>
        </div>

        <section className="mt-10 rounded-2xl border border-soul-line bg-white p-6">
          <h2 className="font-display text-2xl text-soul-blue">Soul Points</h2>
          <p className="mt-2 text-3xl font-semibold text-soul-blue">{money(points)}</p>
          <p className="mt-2 max-w-xl text-sm leading-6 text-soul-muted">
            You earn 1 Soul Point for every 1 EGP on an accepted reservation. Points can later be
            exchanged for vouchers and free nights.
          </p>
        </section>

        {activeStay && (
          <section className="mt-8 rounded-2xl border border-soul-line bg-white p-6">
            <h2 className="font-display text-2xl text-soul-blue">Request housekeeping</h2>
            <p className="mt-2 text-sm text-soul-muted">
              You&apos;re currently staying
              {activeStay.unit_number ? ` in unit ${activeStay.unit_number}` : ''}. You already
              receive one housekeeping visit; request another for a time during your stay.
            </p>
            {activeStay.has_pending_housekeeping ? (
              <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                You already have a housekeeping request in progress. You can request another after
                it is completed.
              </p>
            ) : (
              <form onSubmit={requestHousekeeping} className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-soul-muted">
                  Date
                  <select
                    value={hkDate}
                    onChange={(e) => setHkDate(e.target.value)}
                    className="rounded-xl border border-soul-line px-4 py-3 text-sm text-soul-blue"
                    required
                  >
                    {stayDates.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-soul-muted">
                  Time
                  <select
                    value={hkTime}
                    onChange={(e) => setHkTime(e.target.value)}
                    className="rounded-xl border border-soul-line px-4 py-3 text-sm text-soul-blue"
                    required
                  >
                    {HOUSEKEEPING_TIMES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    disabled={hkBusy || !hkDate || !hkTime}
                    className="rounded-full bg-soul-blue px-6 py-3 text-sm font-semibold uppercase tracking-[0.12em] text-white disabled:opacity-50"
                  >
                    {hkBusy ? 'Sending…' : 'Request housekeeping'}
                  </button>
                </div>
              </form>
            )}
            {hkMsg && (
              <p
                className={`mt-4 rounded-xl px-4 py-3 text-sm ${
                  hkMsg.type === 'success'
                    ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border border-rose-200 bg-rose-50 text-rose-800'
                }`}
              >
                {hkMsg.text}
              </p>
            )}
            {Number(activeStay.guest_housekeeping_count) > 0 && (
              <p className="mt-3 text-xs text-soul-muted">
                Extra requests this stay: {activeStay.guest_housekeeping_count}
              </p>
            )}
          </section>
        )}

        <section className="mt-10">
          <h2 className="font-display text-2xl text-soul-blue">Reservation history</h2>
          <div className="mt-4 space-y-3">
            {loading && <p className="text-sm text-soul-muted">Loading…</p>}
            {!loading &&
              trips.map((t) => (
                <div key={t.id} className="rounded-xl border border-soul-line p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-medium text-soul-blue">
                        {t.listing_title || t.unit_title || 'Stay'}
                      </div>
                      <div className="mt-1 text-sm text-soul-muted">
                        {String(t.checkin).slice(0, 10)} → {String(t.checkout).slice(0, 10)}
                        {t.unit_number ? ` · Unit ${t.unit_number}` : ''}
                      </div>
                    </div>
                    <div className="text-right text-sm">
                      <span className="rounded-full bg-soul-fog px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-soul-blue">
                        {t.status}
                      </span>
                      {t.is_current_stay && (
                        <div className="mt-2 text-xs font-semibold text-emerald-700">Current stay</div>
                      )}
                    </div>
                  </div>
                  {Number(t.total_egp) > 0 && (
                    <p className="mt-2 text-xs text-soul-muted">
                      Total {money(t.total_egp)} EGP · {money(Math.round(Number(t.total_egp) || 0))}{' '}
                      Soul Points when accepted
                    </p>
                  )}
                </div>
              ))}
            {!loading && !trips.length && (
              <p className="text-sm text-soul-muted">No reservations yet.</p>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

export function WishlistPage() {
  const { user } = useAuth();
  const { items, remove } = useWishlist();

  return (
    <div>
      <Header />
      <main className="mx-auto max-w-soul px-5 py-10">
        <h1 className="font-display text-4xl text-soul-blue">Wishlist</h1>
        {!user && items.length > 0 && (
          <p className="mt-2 text-sm text-soul-muted">
            Saved on this device.{' '}
            <Link to="/sign-in" className="font-semibold text-soul-blue underline">
              Sign in
            </Link>{' '}
            to sync across devices.
          </p>
        )}
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((u) => (
            <div key={getListingWpId(u) || u.slug} className="flex flex-col gap-2">
              <ListingCard listing={u} wishlistMode onRemove={() => remove(u)} />
              <button
                type="button"
                onClick={() => remove(u)}
                className="text-sm font-semibold text-soul-muted transition hover:text-[#e0245e]"
              >
                Remove from wishlist
              </button>
            </div>
          ))}
          {!items.length && (
            <p className="col-span-full text-soul-muted">
              Save homes while browsing — sign in to sync across devices.
            </p>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
