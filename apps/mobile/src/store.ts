import * as SecureStore from "expo-secure-store";
import { getLocales } from "expo-localization";
import { Alert, I18nManager } from "react-native";
import { useStore } from "zustand";
import { ApiError } from "@majlis/api-client";
import { createAppStore, type AppState, type TokenStorage } from "@majlis/api-client/store";
import { createT, isRtl, translateError } from "@majlis/i18n";
import type { Locale } from "@majlis/shared";

// Tokens live in the iOS Keychain / Android Keystore.
const storage: TokenStorage = {
  get: (k) => SecureStore.getItemAsync(k),
  set: (k, v) => SecureStore.setItemAsync(k, v),
  remove: (k) => SecureStore.deleteItemAsync(k),
};

// The live API unless a build sets EXPO_PUBLIC_API_URL (e.g. http://<your-LAN-ip>:4000 for local development).
export const API_URL = process.env.EXPO_PUBLIC_API_URL || "https://majlis-sa-api.fly.dev";

// Arabic first; English only if the device language is English.
const deviceLocale: Locale = getLocales()[0]?.languageCode === "en" ? "en" : "ar";

export const app = createAppStore({ baseUrl: API_URL, storage, defaultLocale: deviceLocale });
export const { api, actions } = app;

export function useApp<T>(selector: (s: AppState) => T): T {
  return useStore(app.store, selector);
}

export function useT() {
  return createT(useApp((s) => s.prefs.locale));
}

export function errorMessage(err: unknown): string {
  const locale = app.store.getState().prefs.locale;
  return translateError(locale, err instanceof ApiError ? err.code : undefined);
}

/**
 * React Native applies layout direction at startup. Keep I18nManager in sync
 * with the chosen language; a change takes effect after the app restarts.
 */
export function syncDirection(locale: Locale, notify = false) {
  const rtl = isRtl(locale);
  I18nManager.allowRTL(true);
  if (I18nManager.isRTL !== rtl) {
    I18nManager.forceRTL(rtl);
    if (notify) {
      Alert.alert(
        locale === "ar" ? "إعادة التشغيل مطلوبة" : "Restart required",
        locale === "ar" ? "أعد فتح التطبيق لتطبيق اتجاه اللغة." : "Reopen the app to apply the layout direction.",
      );
    }
  }
}
