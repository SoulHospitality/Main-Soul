import { createContext, useContext, useMemo, useState, useCallback, useEffect } from 'react';
import api from '../api/http';

const CurrencyContext = createContext(null);

const FALLBACK_EGP_PER_USD = Number(import.meta.env.VITE_EGP_USD_RATE || 50);

function roundUsd(egpAmount, egpPerUsd) {
  const rate = egpPerUsd > 0 ? egpPerUsd : FALLBACK_EGP_PER_USD;
  const usd = Number(egpAmount) / rate;
  // Approximate display: whole dollars under $100, one decimal otherwise
  if (usd >= 100) return Math.round(usd);
  return Math.round(usd * 10) / 10;
}

export function CurrencyProvider({ children }) {
  const [currency, setCurrency] = useState(() => localStorage.getItem('soul_currency') || 'EGP');
  const [egpUsdRate, setEgpUsdRate] = useState(FALLBACK_EGP_PER_USD);
  const [rateSource, setRateSource] = useState('fallback');

  useEffect(() => {
    localStorage.setItem('soul_currency', currency);
  }, [currency]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/fx/usd-egp');
        const rate = Number(data?.usd_egp);
        if (!cancelled && rate > 0) {
          setEgpUsdRate(rate);
          setRateSource(data?.source || 'live');
        }
      } catch {
        // Keep fallback — display still works offline
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const formatPrice = useCallback(
    (egpAmount, { perNight = true } = {}) => {
      const n = Number(egpAmount);
      if (!Number.isFinite(n) || n <= 0) return null;
      if (currency === 'USD') {
        const usd = roundUsd(n, egpUsdRate);
        const label = Number.isInteger(usd) ? usd.toLocaleString() : usd.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 });
        return perNight ? `$${label} / night` : `$${label}`;
      }
      return perNight
        ? `EGP ${n.toLocaleString()} / night`
        : `EGP ${n.toLocaleString()}`;
    },
    [currency, egpUsdRate]
  );

  const convertFromEgp = useCallback(
    (egpAmount) => {
      const n = Number(egpAmount);
      if (!Number.isFinite(n)) return 0;
      return currency === 'USD' ? roundUsd(n, egpUsdRate) : n;
    },
    [currency, egpUsdRate]
  );

  const value = useMemo(
    () => ({
      currency,
      setCurrency,
      egpUsdRate,
      rateSource,
      formatPrice,
      convertFromEgp,
    }),
    [currency, egpUsdRate, rateSource, formatPrice, convertFromEgp]
  );

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error('useCurrency must be used within CurrencyProvider');
  return ctx;
}
