"use client";

import { useStore } from "zustand";
import { createAppStore, type AppState, type TokenStorage } from "@majlis/api-client/store";
import { createT, dirOf, translateError } from "@majlis/i18n";
import { ApiError } from "@majlis/api-client";

const storage: TokenStorage = {
  async get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  async set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
  async remove(k) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export const app = createAppStore({ baseUrl: API_URL, storage, defaultLocale: "ar" });
export const { api, actions } = app;

export function useApp<T>(selector: (s: AppState) => T): T {
  return useStore(app.store, selector);
}

export function useLocale() {
  return useApp((s) => s.prefs.locale);
}

export function useT() {
  const locale = useLocale();
  return createT(locale);
}

export function useDir() {
  return dirOf(useLocale());
}

/** Turns any thrown error into a translated, user-facing message. */
export function errorMessage(err: unknown): string {
  const locale = app.store.getState().prefs.locale;
  return translateError(locale, err instanceof ApiError ? err.code : undefined);
}
