import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zh from "./locales/zh.json";
import en from "./locales/en.json";

export type AppLanguage = "zh" | "en";

export const SUPPORTED_LANGUAGES: AppLanguage[] = ["zh", "en"];
export const DEFAULT_LANGUAGE: AppLanguage = "zh";

/**
 * Initialize i18next.
 * Language is initially set to DEFAULT_LANGUAGE (zh).
 * Call `changeLanguage` after loading config from backend.
 */
i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
