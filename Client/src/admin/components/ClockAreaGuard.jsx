import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { useAuth } from '../../context/AuthContext';

const PHONE = /Android.+Mobile|iPhone|iPod|Windows Phone/i;

function distanceMeters(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * While a clocked-in staff member has any PMS page open on their phone, keep watching the location and
 * clock them out as soon as they are clearly outside the office area (the server re-checks the distance).
 * Runs only when location is already allowed, so it never asks for permission outside the clock-in page.
 * The clock-in page has its own check, so this stays off there.
 */
export default function ClockAreaGuard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const sent = useRef(0);
  const staff = Boolean(user && user.role !== 'admin' && user.role !== 'owner');
  const phone = typeof navigator !== 'undefined' && PHONE.test(navigator.userAgent || '');
  const onClockPage = typeof window !== 'undefined' && window.location.pathname.startsWith('/admin/clock');

  const { data } = useQuery({
    queryKey: ['clock-status-guard'],
    queryFn: () => api.get('/clock/status').then((r) => r.data),
    enabled: staff && phone,
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
    retry: false,
  });
  const active = staff && phone && !onClockPage && Boolean(data?.clocked_in && data?.site);

  useEffect(() => {
    if (!active || !navigator.geolocation) return undefined;
    let watchId = null;
    let cancelled = false;
    const start = () => {
      if (cancelled) return;
      watchId = navigator.geolocation.watchPosition(
        (p) => {
          const pos = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
          const site = data.site;
          const outside = distanceMeters(site, pos) - Math.min(pos.accuracy || 0, site.radius_m) > site.radius_m;
          if (!outside || Date.now() - sent.current < 20000) return;
          sent.current = Date.now();
          api
            .post('/clock/left-area', { location: pos })
            .then(({ data: res }) => {
              qc.setQueryData(['clock-status-guard'], res);
              if (res.clocked_out) {
                toast.error(`You left the office area (${res.distance_m} m away), so you were clocked out.`, { duration: 9000 });
              }
            })
            .catch(() => {});
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 }
      );
    };
    // Only when the person already allowed location: never prompt from an unrelated page.
    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'geolocation' })
        .then((perm) => {
          if (perm.state === 'granted') start();
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
    };
  }, [active, data?.site, qc]);

  return null;
}
