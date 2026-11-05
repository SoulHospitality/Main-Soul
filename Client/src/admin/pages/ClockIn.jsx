import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { startAuthentication, startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { Fingerprint, LogIn, LogOut, MapPin, RefreshCw, ShieldCheck, Smartphone, Trash2, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import { ROLE_LABELS } from '../utils/permissions';
import ClockHistory from './clock/ClockHistory';
import { playChime } from '../utils/chime';

const HR_ROLES = new Set(['admin', 'hr', 'hr_supervisor']);
const MAX_ACCURACY_M = 150;

/** Phones only: a mobile browser, a touch screen and a phone-sized screen. */
function isPhoneDevice() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const mobileUa = navigator.userAgentData?.mobile ?? /Android.+Mobile|iPhone|iPod|Windows Phone/i.test(ua);
  const touch = (navigator.maxTouchPoints || 0) > 0;
  const small = Math.min(window.screen?.width || 9999, window.screen?.height || 9999) <= 600;
  return Boolean(mobileUa && touch && small);
}

function distanceMeters(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function timeOf(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' });
}

function errorText(err, fallback) {
  if (err?.name === 'NotAllowedError') {
    return /iPhone|iPad/i.test(navigator.userAgent)
      ? 'Face ID was cancelled or didn’t start. Tap the button again. If it keeps happening, turn on iCloud Keychain (Settings → your name → iCloud → Passwords & Keychain).'
      : 'Fingerprint was cancelled or timed out. Tap the button again.';
  }
  if (err?.name === 'InvalidStateError') return 'This phone is already set up.';
  return err?.response?.data?.error || err?.message || fallback;
}

/** Watches the phone's position while the page is open. */
function usePosition(enabled) {
  const [pos, setPos] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    if (!navigator.geolocation) {
      setError('This browser can’t share your location.');
      return undefined;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setError(null);
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() });
      },
      (e) => {
        setError(
          e.code === 1
            ? 'Location is blocked. Allow location for this site in your browser settings, then reload.'
            : 'Can’t find your location right now. Make sure location (GPS) is on.'
        );
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);
  return { pos, error };
}

function useClock() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ['clock-status'],
    queryFn: () => api.get('/clock/status').then((r) => r.data),
    refetchInterval: 60000,
  });
  const setStatus = useCallback((data) => qc.setQueryData(['clock-status'], data), [qc]);
  return { status, setStatus };
}

function DistanceRing({ site, pos, error }) {
  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
        <MapPin className="mb-1 h-5 w-5" />
        {error}
      </div>
    );
  }
  if (!pos) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-soul-line bg-white p-4 text-sm text-soul-muted">
        <RefreshCw className="h-5 w-5 animate-spin" /> Finding your location…
      </div>
    );
  }
  const d = distanceMeters(site, pos);
  const inside = d <= site.radius_m;
  const vague = pos.accuracy > MAX_ACCURACY_M;
  // Dot position on the ring: the area edge sits at 70% of the drawing radius.
  const scale = Math.min(d / site.radius_m, 1.35) * 0.7;
  const tone = vague ? 'amber' : inside ? 'emerald' : 'rose';
  const colors = { emerald: '#059669', rose: '#e11d48', amber: '#d97706' };
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-soul-line bg-white p-4">
      <svg viewBox="-50 -50 100 100" className="h-24 w-24 shrink-0" aria-hidden>
        <circle r="35" fill={inside ? '#ecfdf5' : '#fff1f2'} stroke={inside ? '#6ee7b7' : '#fda4af'} strokeWidth="1.5" strokeDasharray="3 2" />
        <circle r="2.5" fill="#283f5e" />
        <circle cx={0} cy={-scale * 50} r="4" fill={colors[tone]} stroke="#fff" strokeWidth="1.5" />
      </svg>
      <div className="min-w-0">
        <p className={`text-base font-semibold ${inside && !vague ? 'text-emerald-700' : vague ? 'text-amber-700' : 'text-rose-700'}`}>
          {vague ? 'Location not precise yet' : inside ? 'You’re in the office area' : 'You’re outside the office area'}
        </p>
        <p className="text-sm text-soul-muted">
          {Math.round(d)} m from {site.name || 'the office'} · area {site.radius_m} m
        </p>
        <p className="text-[11px] text-soul-muted">Accuracy ±{Math.round(pos.accuracy)} m</p>
      </div>
    </div>
  );
}

function TeamPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['clock-team'],
    queryFn: () => api.get('/clock/team').then((r) => r.data),
    refetchInterval: 60000,
  });
  const [site, setSite] = useState(null);
  useEffect(() => {
    if (data?.site && !site) setSite({ lat: String(data.site.lat), lng: String(data.site.lng), radius_m: String(data.site.radius_m) });
  }, [data, site]);
  const reset = useMutation({
    mutationFn: (id) => api.delete(`/clock/devices/${id}`),
    onSuccess: () => {
      toast.success('Phone reset. They can set up their new phone now.');
      qc.invalidateQueries({ queryKey: ['clock-team'] });
    },
    onError: (e) => toast.error(errorText(e, 'Could not reset the phone')),
  });
  const saveSite = useMutation({
    mutationFn: () => api.put('/clock/site', { lat: Number(site.lat), lng: Number(site.lng), radius_m: Number(site.radius_m) }),
    onSuccess: () => {
      toast.success('Office location saved');
      qc.invalidateQueries({ queryKey: ['clock-team'] });
      qc.invalidateQueries({ queryKey: ['clock-status'] });
    },
    onError: (e) => toast.error(errorText(e, 'Could not save the location')),
  });
  if (isLoading) return <LoadingSpinner />;
  const staff = data?.staff || [];
  const inNow = staff.filter((s) => s.clocked_in).length;
  return (
    <div className="space-y-4">
      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-semibold text-soul-blue">
            <Users className="h-4 w-4" /> Today at the office
          </h2>
          <span className="text-sm text-soul-muted">
            {inNow} of {staff.length} clocked in now
          </span>
        </div>
        <div className="divide-y divide-soul-line/70">
          {staff.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className={`h-2.5 w-2.5 rounded-full ${s.clocked_in ? 'bg-emerald-500' : s.first_in ? 'bg-slate-300' : 'bg-rose-300'}`} />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-soul-blue">{s.full_name}</p>
                <p className="text-[11px] text-soul-muted">
                  {ROLE_LABELS[s.role] || s.role}
                  {s.first_in ? ` · in ${timeOf(s.first_in)}` : ' · not in yet'}
                  {s.last_out && !s.clocked_in ? ` · out ${timeOf(s.last_out)}` : ''}
                  {s.auto_outs ? ` · left the area ${s.auto_outs}×` : ''}
                </p>
              </div>
              {s.device ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-lg border border-soul-line px-2 py-1 text-[11px] text-soul-muted hover:border-rose-200 hover:text-rose-700"
                  onClick={() => {
                    if (window.confirm(`Reset ${s.full_name}’s phone? They’ll set up fingerprint / Face ID again on their new phone.`)) reset.mutate(s.id);
                  }}
                  title={`Set up ${new Date(s.device.created_at).toLocaleDateString('en-GB')}`}
                >
                  <Smartphone className="h-3.5 w-3.5" /> Reset phone
                </button>
              ) : (
                <span className="text-[11px] text-amber-700">No phone set up</span>
              )}
            </div>
          ))}
        </div>
      </section>
      {site ? (
        <section className="card space-y-3">
          <h2 className="flex items-center gap-2 font-semibold text-soul-blue">
            <MapPin className="h-4 w-4" /> Office location
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div>
              <label className="label">Latitude</label>
              <input className="input" value={site.lat} onChange={(e) => setSite({ ...site, lat: e.target.value })} />
            </div>
            <div>
              <label className="label">Longitude</label>
              <input className="input" value={site.lng} onChange={(e) => setSite({ ...site, lng: e.target.value })} />
            </div>
            <div>
              <label className="label">Area (m)</label>
              <input className="input" type="number" min="50" max="5000" value={site.radius_m} onChange={(e) => setSite({ ...site, radius_m: e.target.value })} />
            </div>
            <div className="flex items-end">
              <button type="button" className="btn-primary w-full" disabled={saveSite.isPending} onClick={() => saveSite.mutate()}>
                Save
              </button>
            </div>
          </div>
          <a className="text-xs font-medium text-soul-blue underline" href={`https://www.google.com/maps/search/?api=1&query=${site.lat},${site.lng}`} target="_blank" rel="noreferrer">
            Check the pin on Google Maps
          </a>
        </section>
      ) : null}
    </div>
  );
}

function PhoneClock() {
  const qc = useQueryClient();
  const { status, setStatus } = useClock();
  const data = status.data;
  const { pos, error: posError } = usePosition(Boolean(data));
  const [busy, setBusy] = useState(false);
  const leaving = useRef(0);

  const site = data?.site;
  const distance = site && pos ? distanceMeters(site, pos) : null;
  const inside = distance != null && distance <= site.radius_m;
  const preciseEnough = pos && pos.accuracy <= MAX_ACCURACY_M;

  // Refresh when the person comes back to the page (phones pause pages in the background).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') status.refetch();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [status]);

  // Left the area while clocked in → clock out automatically (the server double-checks the distance).
  useEffect(() => {
    if (!data?.clocked_in || !pos || !site) return;
    const clearlyOutside = distance - Math.min(pos.accuracy || 0, site.radius_m) > site.radius_m;
    if (!clearlyOutside || Date.now() - leaving.current < 20000) return;
    leaving.current = Date.now();
    api
      .post('/clock/left-area', { location: pos })
      .then(({ data: res }) => {
        setStatus(res);
        if (res.clocked_out) {
          playChime();
          toast.error(`You left the office area (${res.distance_m} m away), so you were clocked out. Clock in again when you’re back.`, { duration: 9000 });
        }
      })
      .catch(() => {});
  }, [data?.clocked_in, pos, site, distance, setStatus]);

  // iPhones only open Face ID when it starts straight from the tap: any network wait in between and
  // Safari refuses (shown as 'timed out'). So the challenge is fetched ahead of time and refreshed
  // before it expires (the server accepts it for 5 minutes), and the tap uses it immediately.
  const purpose = data?.device ? 'punch' : 'register';
  const challenge = useQuery({
    queryKey: ['clock-challenge', purpose],
    queryFn: () => api.post(purpose === 'punch' ? '/clock/options' : '/clock/passkey/options').then((r) => r.data),
    enabled: Boolean(data),
    staleTime: 3 * 60 * 1000,
    refetchInterval: 3 * 60 * 1000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const readyChallenge = () => {
    const fresh = challenge.data && Date.now() - challenge.dataUpdatedAt < 4 * 60 * 1000;
    if (fresh) return challenge.data;
    challenge.refetch();
    toast(challenge.error ? errorText(challenge.error, 'Could not get ready') : 'Getting ready… tap again in a second.');
    return null;
  };
  const nextChallenge = () => qc.invalidateQueries({ queryKey: ['clock-challenge'] });

  const setUp = async () => {
    const opts = readyChallenge();
    if (!opts) return;
    setBusy(true);
    try {
      const response = await startRegistration({ optionsJSON: opts.options });
      const label = /iPhone/i.test(navigator.userAgent) ? 'iPhone' : /Android/i.test(navigator.userAgent) ? 'Android phone' : 'Phone';
      const { data: res } = await api.post('/clock/passkey/register', { token: opts.token, response, label });
      setStatus(res);
      toast.success('Fingerprint / Face ID is set up on this phone');
    } catch (e) {
      toast.error(errorText(e, 'Could not set up fingerprint / Face ID'));
    } finally {
      setBusy(false);
      nextChallenge();
    }
  };

  const punch = async (action) => {
    if (!pos) return toast.error('Waiting for your location…');
    if (action === 'in' && !inside) return toast.error(`You need to be within ${site.radius_m} m of the office to clock in.`);
    const opts = readyChallenge();
    if (!opts) return;
    setBusy(true);
    try {
      const response = await startAuthentication({ optionsJSON: opts.options });
      const { data: res } = await api.post('/clock/punch', { action, token: opts.token, response, location: pos });
      setStatus(res);
      toast.success(action === 'in' ? `Clocked in at ${res.now}` : `Clocked out at ${res.now}`);
    } catch (e) {
      toast.error(errorText(e, action === 'in' ? 'Could not clock in' : 'Could not clock out'));
      status.refetch();
    } finally {
      setBusy(false);
      nextChallenge();
    }
  };

  if (status.isLoading) return <LoadingSpinner />;
  if (status.error) return <EmptyState title={errorText(status.error, 'Could not load clock-in')} />;
  if (!browserSupportsWebAuthn()) {
    return <EmptyState icon={Fingerprint} title="This browser can’t use fingerprint / Face ID. Open the site in Safari (iPhone) or Chrome (Android)." />;
  }

  const att = data.attendance;
  return (
    <div className="mx-auto max-w-md space-y-4">
      <section className="rounded-2xl bg-soul-blue p-5 text-white shadow-lg">
        <p className="text-[11px] uppercase tracking-[0.2em] text-white/60">
          {new Date(`${data.today}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}
        </p>
        <p className="mt-1 text-4xl font-semibold tabular-nums">{data.now}</p>
        <p className="mt-1 text-sm text-white/75">
          {data.day_off ? 'Your day off' : `Shift ${data.shift.start}–${data.shift.end}`}
          {data.clocked_in ? ' · you’re clocked in' : ''}
        </p>
      </section>

      {!data.office_attendance ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Your role doesn’t use office attendance, so clocking in won’t change your attendance record.
        </p>
      ) : null}

      <DistanceRing site={site} pos={pos} error={posError} />

      {!data.device ? (
        <section className="card space-y-3 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-soul-blue" />
          <p className="font-semibold text-soul-blue">Set up fingerprint / Face ID</p>
          <p className="text-sm text-soul-muted">
            One time only. Your phone confirms it’s you each time you clock in. Only this phone will work for your clock-in; if you change
            phones, ask HR to reset it.
          </p>
          <button type="button" className="btn-primary w-full justify-center py-3" disabled={busy} onClick={setUp}>
            <Fingerprint className="h-5 w-5" /> {busy ? 'Waiting…' : 'Set up on this phone'}
          </button>
        </section>
      ) : data.clocked_in ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => punch('out')}
          className="flex w-full items-center justify-center gap-3 rounded-2xl bg-rose-600 py-5 text-lg font-semibold text-white shadow-lg active:scale-[0.99] disabled:opacity-60"
        >
          <LogOut className="h-6 w-6" /> {busy ? 'Confirm with fingerprint / Face ID…' : 'Clock out'}
        </button>
      ) : (
        <button
          type="button"
          disabled={busy || !inside || !preciseEnough}
          onClick={() => punch('in')}
          className="flex w-full items-center justify-center gap-3 rounded-2xl bg-emerald-600 py-5 text-lg font-semibold text-white shadow-lg active:scale-[0.99] disabled:bg-slate-300"
        >
          <Fingerprint className="h-6 w-6" />
          {busy ? 'Confirm with fingerprint / Face ID…' : !pos ? 'Waiting for location…' : !preciseEnough ? 'Waiting for a precise location…' : inside ? 'Clock in' : 'Get to the office to clock in'}
        </button>
      )}

      {att ? (
        <section className="card grid grid-cols-2 gap-2 text-center">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-soul-muted">First clock-in</p>
            <p className="font-semibold tabular-nums text-soul-blue">{att.check_in || '—'}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-soul-muted">Last clock-out</p>
            <p className="font-semibold tabular-nums text-soul-blue">{att.check_out || (data.clocked_in ? 'Still in' : '—')}</p>
          </div>
        </section>
      ) : null}

      {data.events.length ? (
        <section className="card space-y-2">
          <p className="text-sm font-semibold text-soul-blue">Today</p>
          <ol className="space-y-1.5">
            {data.events.map((e, i) => (
              <li key={`${e.at}-${i}`} className="flex items-center gap-2 text-sm">
                {e.kind === 'in' ? <LogIn className="h-4 w-4 text-emerald-600" /> : <LogOut className="h-4 w-4 text-rose-600" />}
                <span className="tabular-nums text-soul-blue">{timeOf(e.at)}</span>
                <span className="text-soul-muted">
                  {e.kind === 'in' ? 'Clocked in' : e.source === 'left_area' ? `Clocked out automatically (left the area, ${e.distance_m} m)` : 'Clocked out'}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <p className="text-center text-[11px] text-soul-muted">
        Keep this page open during your shift. If you leave the {site.radius_m} m office area while it’s open, you’re clocked out
        automatically and need to clock in again when you’re back.
      </p>
    </div>
  );
}

export default function ClockIn() {
  const { user } = useAuth();
  const phone = useMemo(isPhoneDevice, []);
  const isAdmin = user?.role === 'admin';
  const isHr = HR_ROLES.has(user?.role);
  const [showTeam, setShowTeam] = useState(!phone);

  // CEOs don't clock in: they get everyone's clock-ins, on any device.
  if (isAdmin) {
    return (
      <div className="space-y-5">
        <div className="page-header mb-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-soul-muted">Attendance</p>
          <h1 className="page-title mt-1">Clock-ins</h1>
          <p className="page-subtitle">Everyone’s phone clock-ins and clock-outs. Filter by person and dates; tap a day to see each clock-in.</p>
        </div>
        <ClockHistory />
        <TeamPanel />
      </div>
    );
  }

  const managerPanels = (
    <>
      <ClockHistory />
      <TeamPanel />
    </>
  );

  return (
    <div className="space-y-5">
      <div className="page-header mb-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-soul-muted">Attendance</p>
        <h1 className="page-title mt-1">Clock in</h1>
      </div>

      {phone ? (
        <PhoneClock />
      ) : (
        <div className="card flex items-start gap-4">
          <Smartphone className="h-10 w-10 shrink-0 text-soul-blue" />
          <div>
            <p className="font-semibold text-soul-blue">Open this page on your phone</p>
            <p className="mt-1 text-sm text-soul-muted">
              Clock-in only works on a phone, with fingerprint or Face ID and your location. Sign in on your phone and open{' '}
              <span className="font-medium text-soul-blue">{window.location.origin}/admin/clock</span>.
            </p>
          </div>
        </div>
      )}

      {isHr ? (
        phone ? (
          <div className="space-y-3">
            <button type="button" className="btn-secondary w-full justify-center" onClick={() => setShowTeam((v) => !v)}>
              <Users className="h-4 w-4" /> {showTeam ? 'Hide team' : 'Team clock-ins & office location'}
            </button>
            {showTeam ? managerPanels : null}
          </div>
        ) : (
          managerPanels
        )
      ) : null}
    </div>
  );
}
