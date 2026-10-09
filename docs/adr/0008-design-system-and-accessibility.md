# 0008 — Design system and accessibility

- Status: Accepted
- Date: 2026-10-09

## Context

The app must be intuitive, clean and modern, keep gamification motivating without dark patterns, and target WCAG 2.2 AA.

## Decision

- Calm editorial visual direction: whitespace, one accent color, neutral ramp, hanzi as the visual hero; discreet gamification (slim header with streak, XP, league).
- shadcn/ui on Radix primitives, Tailwind v4 tokens (color, type, spacing, radius, motion), light/dark/system.
- Navigation: guided "Today" session plus Today / Learn / Read / Profile tabs (bottom bar on mobile, sidebar from 1024px).
- Tone colors are colorblind-safe and always paired with diacritics.
- Fonts self-hosted and subset; a Kai-style display face for word and stroke screens.
- Accessibility rules: `lang` on every foreign-language span, `<ruby>` pinyin, single-pointer alternative to stroke drawing, non-speech alternative to every mic exercise, no mandatory time limits, 24px minimum targets, visible focus, reduced-motion support, text alternatives for visual widgets.
- Tooling: `eslint-plugin-jsx-a11y`, `@axe-core/playwright` blocking in CI, manual keyboard/NVDA/VoiceOver checks per milestone, accessibility statement at v1.
- Key screens are mocked up and approved before UI implementation (M0).

## Consequences

- Accessibility is enforced continuously rather than audited at the end.
