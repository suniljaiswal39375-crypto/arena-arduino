'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { LANGUAGE_KEY, parseLocale, translate, type Locale, type MessageKey } from './messages';

type Translator = (key: MessageKey, values?: Record<string, string | number>) => string;
const LanguageContext = createContext<{ locale: Locale; setLocale: (locale: Locale) => void; t: Translator }>({
  locale: 'en', setLocale: () => undefined, t: (key, values) => translate('en', key, values),
});

/** Default English makes server markup deterministic; read preferences after hydration. */
export function LanguageProvider({ children, initialLocale = 'en' }: { children: React.ReactNode; initialLocale?: Locale }) {
  const [locale, setState] = useState<Locale>(initialLocale);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LANGUAGE_KEY);
      if (stored !== null) setState(parseLocale(stored));
    } catch { /* In-memory switching works with blocked storage too. */ }
    const onStorage = (event: StorageEvent) => {
      if (event.key === LANGUAGE_KEY || event.key === null) setState(parseLocale(event.newValue));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const setLocale = useCallback((value: Locale) => {
    const next = parseLocale(value);
    setState(next);
    try { localStorage.setItem(LANGUAGE_KEY, next); } catch { /* Keep the page usable. */ }
  }, []);
  const value = useMemo(() => ({ locale, setLocale, t: (key: MessageKey, values?: Record<string, string | number>) => translate(locale, key, values) }), [locale, setLocale]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
export const useI18n = () => useContext(LanguageContext);
