import { createContext, useContext, useMemo, useState, useCallback, useEffect } from 'react';

const CurrencyContext = createContext(null);

const EGP_USD_RATE = Number(import.meta.env.VITE_EGP_USD_RATE || 50);

export function CurrencyProvider({ children }) {
  const [currency, setCurrency] = useState(() => localStorage.getItem('soul_currency') || 'EGP');

  useEffect(() => {
    localStorage.setItem('soul_currency', currency);
  }, [currency]);

  const formatPrice = useCallback(
    (egpAmount, { perNight = true } = {}) => {
      const n = Number(egpAmount);
      if (!Number.isFinite(n) || n <= 0) return null;
      if (currency === 'USD') {
        const usd = Math.round(n / EGP_USD_RATE);
        return perNight ? `$${usd.toLocaleString()} / night` : `$${usd.toLocaleString()}`;
      }
      return perNight
        ? `EGP ${n.toLocaleString()} / night`
        : `EGP ${n.toLocaleString()}`;
    },
    [currency]
  );

  const convertFromEgp = useCallback(
    (egpAmount) => {
      const n = Number(egpAmount);
      if (!Number.isFinite(n)) return 0;
      return currency === 'USD' ? Math.round(n / EGP_USD_RATE) : n;
    },
    [currency]
  );

  const value = useMemo(
    () => ({
      currency,
      setCurrency,
      egpUsdRate: EGP_USD_RATE,
      formatPrice,
      convertFromEgp,
    }),
    [currency, formatPrice, convertFromEgp]
  );

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error('useCurrency must be used within CurrencyProvider');
  return ctx;
}
