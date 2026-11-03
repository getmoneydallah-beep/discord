/** Design tokens shared by web (CSS variables) and mobile (StyleSheet). */
export const colors = {
  // Brand: deep green with a warm sand accent.
  brand: "#0F8A5F",
  brandHover: "#0B7350",
  accent: "#C8A165",
  danger: "#D9443B",
  success: "#2DA567",
  dark: {
    bg: "#14171A",
    sidebar: "#1B1F23",
    rail: "#101316",
    surface: "#22272C",
    surfaceHover: "#2A3036",
    border: "#2F353B",
    text: "#E8EAED",
    textMuted: "#9AA3AB",
  },
  light: {
    bg: "#FFFFFF",
    sidebar: "#F4F5F6",
    rail: "#E7E9EB",
    surface: "#FFFFFF",
    surfaceHover: "#EEF0F2",
    border: "#DDE1E4",
    text: "#1B1F23",
    textMuted: "#5F6870",
  },
} as const;

export const radii = { sm: 6, md: 10, lg: 16, full: 9999 } as const;
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const fontFamily = {
  sans: "IBM Plex Sans Arabic",
} as const;
