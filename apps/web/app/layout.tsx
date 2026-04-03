import type { Metadata } from "next";
import { cookies } from "next/headers";

import { LANGUAGE_COOKIE_NAME, resolveLanguage } from "../lib/i18n";
import { LanguageProvider, LanguageToggle } from "./language-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "ForgeFlow",
  description: "Multi-agent AI development orchestrator",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const language = resolveLanguage(cookieStore.get(LANGUAGE_COOKIE_NAME)?.value);

  return (
    <html lang={language === "zh" ? "zh-CN" : "en"}>
      <body>
        <LanguageProvider initialLanguage={language}>
          <div className="app-toolbar">
            <div className="app-toolbar-inner">
              <LinkBrand language={language} />
              <LanguageToggle />
            </div>
          </div>
          {children}
        </LanguageProvider>
      </body>
    </html>
  );
}

function LinkBrand({ language }: { language: "zh" | "en" }) {
  return (
    <div className="toolbar-brand">
      <span className="toolbar-brand-mark">FF</span>
      <div>
        <strong>ForgeFlow</strong>
        <div className="muted">{language === "zh" ? "多 Agent 开发调度台" : "Multi-agent delivery control deck"}</div>
      </div>
    </div>
  );
}
