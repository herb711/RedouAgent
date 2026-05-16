import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { fetchJSON } from "@/lib/api";
import type { Locale, Translations } from "./types";
import { en } from "./en";
import { zh } from "./zh";

const TRANSLATIONS: Record<Locale, Translations> = {
  zh,
  en,
};

export const LOCALE_META: Record<
  Locale,
  { name: string; shortName: string }
> = {
  zh: { name: "中文", shortName: "中" },
  en: { name: "English", shortName: "EN" },
};

const SUPPORTED_LOCALES = Object.keys(TRANSLATIONS) as Locale[];
const STORAGE_KEY = "redou-agent-locale";
const LEGACY_STORAGE_KEY = "hermes-locale";

function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as string[]).includes(value);
}

function storedLocale(): Locale | null {
  try {
    const stored =
      localStorage.getItem(STORAGE_KEY) ??
      localStorage.getItem(LEGACY_STORAGE_KEY);
    if (stored && isLocale(stored)) return stored;
  } catch {
    // SSR or privacy mode
  }
  return null;
}

function persistLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function getInitialLocale(): Locale {
  return storedLocale() ?? "zh";
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: Translations;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "zh",
  setLocale: () => {},
  t: zh,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);

  useEffect(() => {
    let cancelled = false;
    fetchJSON<{ language?: string }>("/api/dashboard/language")
      .then((result) => {
        if (cancelled) return;
        const next = result.language && isLocale(result.language)
          ? result.language
          : "zh";
        setLocaleState(next);
        persistLocale(next);
      })
      .catch(() => {
        // Keep the local/default language if the dashboard API is not ready yet.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    persistLocale(l);
    void fetchJSON<{ ok: boolean; language: Locale }>("/api/dashboard/language", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: l }),
    }).catch(() => {
      // Local choice still applies for this browser session.
    });
  }, []);

  const value: I18nContextValue = {
    locale,
    setLocale,
    t: TRANSLATIONS[locale],
  };

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
