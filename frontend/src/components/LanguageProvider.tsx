'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  getLocaleFromPathname,
  localeToHtmlLang,
  normalizeLocale,
  translate,
  type I18nKey,
  type Locale,
} from '@/lib/i18n';

interface LanguageContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: I18nKey, values?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({
  initialLocale = DEFAULT_LOCALE,
  children,
}: {
  initialLocale?: Locale;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(() => normalizeLocale(initialLocale));

  useEffect(() => {
    let cancelled = false;
    let nextLocale = DEFAULT_LOCALE;
    try {
      const urlLocale = getLocaleFromPathname(window.location.pathname);
      if (urlLocale) {
        nextLocale = urlLocale;
        try {
          localStorage.setItem(LOCALE_STORAGE_KEY, urlLocale);
        } catch {
          // 隐私模式或受限浏览器可能禁止本地存储，但 URL 语言仍应生效。
        }
      } else {
        nextLocale = normalizeLocale(localStorage.getItem(LOCALE_STORAGE_KEY));
      }
    } catch {
      nextLocale = DEFAULT_LOCALE;
    }
    document.documentElement.lang = localeToHtmlLang(nextLocale);
    queueMicrotask(() => {
      if (!cancelled) setLocaleState(nextLocale);
    });
    return () => { cancelled = true; };
  }, []);

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
    } catch {
      // Storage can be unavailable in hardened/private browser modes.
    }
    document.documentElement.lang = localeToHtmlLang(nextLocale);
  }, []);

  const value = useMemo<LanguageContextValue>(() => ({
    locale,
    setLocale,
    t: (key, values) => translate(locale, key, values),
  }), [locale, setLocale]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n(): LanguageContextValue {
  const value = useContext(LanguageContext);
  if (!value) {
    throw new Error('useI18n must be used within LanguageProvider');
  }
  return value;
}

