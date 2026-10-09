# 0008 — Design system and accessibility

- Status: Accepted
- Date: 2026-10-09

## Context

The app must be intuitive, clean and modern, keep gamification motivating without dark patterns, and target WCAG 2.2 AA.

## Decision

- "Ink and tone" visual direction: calm editorial layout, monochrome ink interface (no accent color), hanzi as the visual hero; color is reserved for the Mandarin tones. Discreet gamification (streak and XP chips, league line). Values in [`docs/design/DESIGN-SYSTEM.md`](../design/DESIGN-SYSTEM.md).
- shadcn/ui on Radix primitives, Tailwind v4 tokens (color, type, spacing, radius, motion), light/dark/system.
- Navigation: guided "Today" session plus Today / Learn / Read / Profile tabs (bottom bar on mobile, sidebar from 1024px).
- Tone colors are computed for contrast (≥ 5.2:1 light) and colorblind separation (smallest ΔE ≥ 30 under protanopia, deuteranopia and tritanopia), stay the same hue in both themes, and are always paired with diacritics.
- Fonts self-hosted and subset: Atkinson Hyperlegible Next (Latin UI), Noto Sans SC (Chinese UI, pinyin), LXGW WenKai (display characters), all OFL-1.1.
- Accessibility rules: `lang` on every foreign-language span, `<ruby>` pinyin, single-pointer alternative to stroke drawing, non-speech alternative to every mic exercise, no mandatory time limits, 24px minimum targets, visible focus, reduced-motion support, text alternatives for visual widgets.
- Tooling: `eslint-plugin-jsx-a11y`, `@axe-core/playwright` blocking in CI, manual keyboard/NVDA/VoiceOver checks per milestone, accessibility statement at v1.
- Key screens are mocked up and approved before UI implementation (M0).

## Consequences

- Accessibility is enforced continuously rather than audited at the end.
