import type { ExpoConfig } from "expo/config";

// API URL: set EXPO_PUBLIC_API_URL for builds (EAS env), defaults to local dev.
const config: ExpoConfig = {
  name: "مجلس",
  slug: "majlis",
  scheme: "majlis",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  ios: {
    bundleIdentifier: "app.majlis",
    supportsTablet: true,
    // Universal links (https://majlis.app/invite/CODE opens the app) need a paid Apple
    // developer account and the real domain, so they're only added for store builds.
    ...(process.env.MAJLIS_UNIVERSAL_LINKS === "1" ? { associatedDomains: ["applinks:majlis.app"] } : {}),
    infoPlist: {
      CFBundleDevelopmentRegion: "ar",
      CFBundleLocalizations: ["ar", "en"],
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "app.majlis",
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#03825D" },
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [{ scheme: "https", host: "majlis.app", pathPrefix: "/invite" }],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  locales: { ar: "./locales/ar.json", en: "./locales/en.json" },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-localization",
    ["expo-video", { supportsBackgroundPlayback: false, supportsPictureInPicture: true }],
    ["expo-document-picker", { iCloudContainerEnvironment: "Production" }],
  ],
  experiments: { typedRoutes: false },
  extra: {
    // Lets the app flip to RTL (I18nManager) for Arabic.
    supportsRTL: true,
  },
};

export default config;
