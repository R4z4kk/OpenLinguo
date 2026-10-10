# Design system — Ink and tone

Approved by the maintainer on 2026-10-09 (issue #9), from a private design canvas with the token sheet and eight key mobile screens. Implementation starts with the PWA shell (#22).

## Principle

The interface is monochrome, ink on paper. Color carries one meaning only: the Mandarin tones. Buttons and links are never colored, so a green always means "tone 3". Tone is always written by its diacritic (ā á ǎ à); color doubles it and never carries it alone (WCAG 1.4.1).

## Interface colors

Contrast ratios are WCAG 2.x (relative luminance per WCAG 2.2), against the ground named in each cell. The values live in `apps/web/src/styles.css` as `light-dark(light, dark)`; `apps/web/src/design/tokens.test.ts` checks every ratio below in CI, and that `ink`, `muted` and `danger` stay ≥ 4.5:1 and `border-strong` ≥ 3:1 on `bg`, `surface` and `sunken` in both themes.

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#F6F7F5` | `#121514` | Page ground |
| `surface` | `#FFFFFF` | `#1A1E1C` | Cards, sheets, navigation |
| `sunken` | `#EEF0ED` | `#232826` | Tracks, selected rows, inset blocks |
| `hairline` | `#DADDD8` | `#2E3431` | Decorative separators only |
| `border-strong` | `#7E8580` (3.5:1 on `bg`) | `#7A827E` (4.3:1 on `surface`) | Control boundaries (WCAG 1.4.11) |
| `ink` | `#191C1A` (16.0:1 on `bg`) | `#ECEFED` (15.9:1 on `bg`) | Text, primary buttons, focus ring |
| `on-ink` | `#FFFFFF` (17.2:1 on `ink`) | `#121514` (15.9:1 on `ink`) | Text on primary buttons |
| `muted` | `#555B57` (6.5:1 on `bg`, 6.1:1 on `sunken`) | `#A3ABA6` (7.2:1 on `surface`) | Secondary text |
| `danger` | `#B42318` (6.6:1 on `surface`) | `#F2827A` (6.6:1 on `surface`) | Destructive actions only |

## Tone colors

| Tone | Light | Contrast on white | Dark | Contrast on `bg` |
|---|---|---|---|---|
| 1 · high | `#AF2D0B` | 6.6:1 | `#DF6445` | 5.3:1 |
| 2 · rising | `#A20B9F` | 6.8:1 | `#AB6AE3` | 5.2:1 |
| 3 · dipping | `#0B796E` | 5.3:1 | `#71E1BB` | 11.5:1 |
| 4 · falling | `#0619DB` | 9.7:1 | `#A3B2DD` | 8.7:1 |
| neutral | `#5F6662` | 5.9:1 | `#A3ABA6` | 7.8:1 |

**Tone-colored text sits on `bg` or `surface` only**, never on `sunken`: in the dark theme tones 1 and 2 reach only 4.3:1 and 4.2:1 on `sunken` (decision 2026-10-09, the colors are kept). A selected row or inset block that shows colored pinyin uses an outline instead of `sunken`. Every tone is ≥ 4.7:1 on `bg` and `surface` in both themes (checked in CI). Tone 2 stays purple in both themes so a learner keeps one color per tone.

**Colorblind separation.** The palette was found by a search maximizing the smallest color difference (CIE76 ΔE in Lab) between any two tones, under normal vision and simulated protanopia, deuteranopia and tritanopia (Machado, Oliveira and Fernandes 2009, severity 1.0 matrices applied to linear sRGB and clamped, then CIE Lab with a D65 white), within the contrast constraints and the usual hue families (red-orange, purple, green-teal, blue).

| Smallest ΔE between two tones | Normal | Protanopia | Deuteranopia | Tritanopia |
|---|---|---|---|---|
| Light | 52.7 | 37.5 | 31.5 | 30.6 |
| Dark | 54.8 | 38.2 | 30.4 | 32.6 |

For comparison, an Okabe-Ito-derived starting palette dropped to 8.6 under protanopia. The ΔE values above are recomputed by the CI test (they differed by up to 0.4 from the search's own figures, corrected 2026-10-09), which also requires every simulated deficiency to stay ≥ 30.

## Typography

| Role | Typeface | License |
|---|---|---|
| Latin interface | Atkinson Hyperlegible Next (Braille Institute, designed for legibility) | OFL-1.1 |
| Chinese interface and pinyin (all tone diacritics) | Noto Sans SC | OFL-1.1 |
| Display characters (word page, cards, strokes) | LXGW WenKai GB, a Kai face close to handwriting with the mainland standard character forms (通用规范汉字表) taught for the HSK (v1.522, decision 2026-10-09) | OFL-1.1 |
| Fallback display | Noto Sans SC (already loaded; Noto Serif SC dropped, 2026-10-09) | OFL-1.1 |

All fonts are self-hosted; no third-party font CDN at runtime (GDPR). The CJK fonts are cut by `tools/data-pipeline` into `unicode-range` slices that follow the HSK 2025 bands (Latin and pinyin, punctuation, symbols, HSK 1 … 7-9, GF0025-2021, then the other dataset characters by frequency), so an HSK 1 page loads 67 KB of Noto Sans SC and 51 KB of LXGW WenKai GB, against 368 KB and 587 KB with frequency-ordered slices (measured 2026-10-09, budget checked in CI by `apps/web/src/design/fonts.test.ts`).

| Style | Size / line height |
|---|---|
| Display character | 64 px on a phone up to 96 px (fluid), line height 1.25 to leave room for the ruby pinyin |
| Title | 28 / 36 px, weight 700 |
| Subtitle | 22 / 28 px, weight 600 |
| Pinyin | 18 / 24 px |
| Body | 16 / 24 px |
| Small | 14 / 20 px |
| Caption (minimum) | 12 / 16 px |

## Space, shape, motion

- Spacing on a 4 px step: 4, 8, 12, 16, 24, 32, 48, 64.
- Radius: 6 px for controls, 12 px for cards, full pill for chips.
- Touch targets ≥ 44 px (above the WCAG 2.5.8 minimum of 24 px).
- Motion: 150 ms ease-out; removed under `prefers-reduced-motion`.
- Focus: 2 px ink ring, 2 px offset, never hidden by sticky elements.

## Information architecture

- Mobile: bottom tabs Today / Learn / Read / Profile. From 1024 px: sidebar.
- **Today** runs the composed session from one button: reviews → new words → tone drill → 5-sentence challenge.
- Gamification stays quiet: streak and XP chips in the Today header, league line under the session. No loss messages, streak freeze, notifications opt-in only. Leagues use pseudonyms and predefined avatars.

## Screen patterns

- **Review**: progress bar, one card, grading buttons À revoir / Difficile / Bien / Facile with next intervals; "Bien" is the single filled button.
- **Card types**: recognition, recall (French → Chinese), listening, tone choice (four buttons with diacritic, color and tone number), writing with a stroke-order quiz alternative.
- **Word page**: pinyin, audio, FR and EN glosses, decomposition as a nested list (word → characters → components), stroke count and stroke order.
- **Pronunciation studio**: reference (dashed) and user (solid) pitch curves, per-syllable text result, sandhi hint, on-device processing notice, "Je ne peux pas parler maintenant".
- **Writing studio**: five contexts, AI correction shown as a labeled proposal ("Généré par IA") with inserted characters underlined, accept or keep, optional card creation.
- **Reader**: unknown words dotted-underlined, tapped word outlined, word sheet at the bottom.
- **Profile**: streak, retention, words learned, time; league table with the user's row highlighted; settings for AI provider, display, data and privacy (export, delete).

## Accessibility rules

- `lang="zh-Hans"` on Chinese text and `lang="zh-Latn-pinyin"` on pinyin.
- Stroke drawing always has a single-pointer alternative (WCAG 2.5.7).
- Every microphone exercise offers a non-speech alternative without penalty.
- No mandatory time limit (WCAG 2.2.1).
- Curves, trees and heatmaps have a text equivalent.
