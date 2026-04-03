export type Language = "en" | "zh";

export const LANGUAGE_COOKIE_NAME = "forgeflow-lang";

function pad(value: number) {
  return value.toString().padStart(2, "0");
}

export function resolveLanguage(value?: string | null): Language {
  return value === "zh" ? "zh" : "en";
}

export function languageLabel(language: Language) {
  return language === "zh" ? "中文" : "English";
}

export function formatDateTime(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Invalid date";
  }

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatTime(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Invalid time";
  }

  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
