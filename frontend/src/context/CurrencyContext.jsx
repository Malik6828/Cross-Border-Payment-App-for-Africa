import React, { createContext, useContext, useState } from 'react';

const STORAGE_KEY = 'afripay_display_currency';
const VALID_CODES = ['XLM', 'USD', 'NGN', 'GHS', 'KES'];
const DEFAULT = 'USD';

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return VALID_CODES.includes(v) ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

const CurrencyContext = createContext(null);

export function CurrencyProvider({ children }) {
  const [displayCurrency, setDisplayCurrency] = useState(readStored);

  const setAndPersist = (code) => {
    const safe = VALID_CODES.includes(code) ? code : DEFAULT;
    try { localStorage.setItem(STORAGE_KEY, safe); } catch {}
    setDisplayCurrency(safe);
  };

  return (
    <CurrencyContext.Provider value={{ displayCurrency, setDisplayCurrency: setAndPersist }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export const useCurrency = () => useContext(CurrencyContext);
