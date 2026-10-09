# @openlinguo/web

The PWA: Vite, React, TanStack Router, Tailwind v4, `vite-plugin-pwa`.

```bash
pnpm --filter @openlinguo/web dev
pnpm --filter @openlinguo/web build
pnpm --filter @openlinguo/web preview
```

- Design tokens live in `src/styles.css` (`light-dark(light, dark)` colors, type, radius, motion) and nowhere else; `src/design/tokens.test.ts` checks their contrast ratios and the tone palette's colorblind separation against `docs/design/DESIGN-SYSTEM.md`.
- Theme: `system` follows the OS through `color-scheme`; an explicit choice sets `data-theme` on `<html>` and is stored locally.
- Each module route has its own error boundary (`errorComponent`); a failing module leaves the navigation usable.
- `public/_headers` holds the security headers for Cloudflare Pages; `vite preview` applies the same file, so a CSP violation shows up locally.
- A new version is offered with a reload button, never applied in the middle of a session.
- Offline data: `pnpm data` (run by `dev` and `build`) merges the committed datasets into `public/data/` (not committed): one dictionary entry per simplified form and reading, CC-CEDICT glosses with the CFDICT and Wiktionary French glosses (each labeled with its source), French-only words outside the segmentation lexicon, HSK 2025 and GF0025-2021 levels, Make Me a Hanzi decompositions, and an `index.json` with each file's sha256. On first run the app imports them into IndexedDB (Dexie) behind a progress screen: each file is verified and stored in one transaction, so an interrupted import resumes, and a new data version replaces the old one. Errors are shown with a retry button; the result of `navigator.storage.persist()` is shown on that screen and in Profile.
- Fonts: Atkinson Hyperlegible Next from npm; Noto Sans SC 400 / 700 and LXGW WenKai GB from `data/font-*/fonts.css`, sliced by HSK band (see `data/SOURCES.md`). Assets are never inlined (the CSP blocks `data:`); the Latin, punctuation and HSK 1-2 slices are precached, the others cached on first use. `src/design/fonts.test.ts` keeps an HSK 1 page under its budget.
- Languages: `src/i18n/en.ts` is the reference catalog; `fr.ts` is typed on its shape, so a missing or extra key fails typecheck, and so does `t()` with an unknown key. The language is the stored choice, else the browser's first supported language, else English; `<html lang>` follows it, and text in another language carries its own `lang`.
