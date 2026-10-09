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
