"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { LANGUAGE_COOKIE_NAME, type Language, languageLabel, resolveLanguage } from "../lib/i18n";

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

function persistLanguage(language: Language) {
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.cookie = `${LANGUAGE_COOKIE_NAME}=${language}; path=/; max-age=31536000; samesite=lax`;
  window.localStorage.setItem(LANGUAGE_COOKIE_NAME, language);
}

export function LanguageProvider({
  children,
  initialLanguage,
}: Readonly<{
  children: React.ReactNode;
  initialLanguage: Language;
}>) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  useEffect(() => {
    persistLanguage(language);
  }, [language]);

  useEffect(() => {
    const saved = window.localStorage.getItem(LANGUAGE_COOKIE_NAME);
    const nextLanguage = resolveLanguage(saved);

    if (saved && nextLanguage !== language) {
      persistLanguage(nextLanguage);
      setLanguageState(nextLanguage);
    }
  }, [language]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage: (nextLanguage) => {
        persistLanguage(nextLanguage);
        setLanguageState(nextLanguage);
      },
    }),
    [language],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);

  if (!context) {
    throw new Error("useLanguage must be used inside LanguageProvider");
  }

  return context;
}

export function LanguageToggle() {
  const router = useRouter();
  const { language, setLanguage } = useLanguage();

  return (
    <div className="language-toggle" role="group" aria-label="Language toggle">
      {(["en", "zh"] as const).map((value) => (
        <button
          key={value}
          type="button"
          className={language === value ? "active" : ""}
          onClick={() => {
            setLanguage(value);
            router.refresh();
          }}
        >
          {languageLabel(value)}
        </button>
      ))}
    </div>
  );
}
