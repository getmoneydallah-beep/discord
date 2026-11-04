# Majlis brand

**Mark:** the Arabic letter «م» (meem) inside a pointed majlis arch, with a small gold diamond. It reads as a doorway to a gathering, and stays legible at 16–32px. It was generated with ChatGPT image (`gpt_image_2_5`) on Higgsfield, picked from 8 concepts, then cropped and exported in code.

| File | Use |
|---|---|
| `apps/web/public/brand/mark-512.png`, `mark-192.png` | Rounded mark with transparent corners: header, footer, sign-in, splash |
| `apps/web/app/icon.png` | Browser tab icon (Next.js serves it as `/icon.png`) |
| `apps/web/app/apple-icon.png` | iOS home-screen icon (180px, full-bleed) |
| `apps/web/public/brand/icon-1024.png`, `apps/mobile/assets/icon.png` | App Store / Play icon (1024px, full-bleed square; the stores round the corners) |
| `apps/mobile/assets/adaptive-icon.png` | Android adaptive icon foreground (on `#03825D`) |
| `apps/web/public/brand/logo-lockup-concept.png` | First-round concept with the wordmark and seated figures (reference only, too detailed for small sizes) |

**Colours:** emerald `#0F8A5F` (UI) / `#03825D` (icon background), gold accent `#C8A165`, white.

**Wordmark:** «مجلس» / "Majlis" set in IBM Plex Sans Arabic Bold, next to the mark. It's set as text in code, not as an image, so it stays sharp and switches language.

**Still needed for print or a large hero:** a vector (SVG) version of the mark, traced by a designer from `icon-1024.png`.
