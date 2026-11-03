import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { actions, app, syncDirection, useApp } from "@/store";
import { usePalette } from "@/ui";

// Apply the saved/default direction as early as possible.
syncDirection(app.store.getState().prefs.locale);

export default function RootLayout() {
  const p = usePalette();
  const locale = useApp((s) => s.prefs.locale);

  useEffect(() => {
    void actions.boot();
    const t = setInterval(() => actions.pruneTyping(), 2000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    syncDirection(locale, true);
  }, [locale]);

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: p.sidebar },
          headerTintColor: p.text,
          contentStyle: { backgroundColor: p.bg },
        }}
      />
    </SafeAreaProvider>
  );
}
