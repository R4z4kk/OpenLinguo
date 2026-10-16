# 0011 — Writing and typing

- Status: Accepted
- Date: 2026-10-16

## Context

M4 adds two card types: writing (draw the strokes of a word) and typing (type a word through a pinyin input method), plus typing exercises with optional timers. Exit criteria: writing and typing cards are scheduled by FSRS, and a keyboard-only path works. The word page already draws stroke order with in-house SVG (Hanzi Writer was rejected there on 2026-10-10), and the dictionary already holds CC-CEDICT readings, wordfreq Zipf frequencies and a toneless pinyin search index.

## Options and tests (2026-10-16)

### Writing quiz

- **Hanzi Writer 3.7.3** ([chanind/hanzi-writer](https://github.com/chanind/hanzi-writer), MIT, released 2025-09-17, 10.7 KB gzipped). Its source (`dist/index.esm.js`): colors are parsed from hex or `rgb()` strings only, so CSS variables cannot theme it; input uses mouse and touch events, not Pointer Events; the `mouseup` and `touchend` listeners it adds to `document` are never removed (no `removeEventListener` in the build), one more per instance; no keyboard or ARIA support; reduced motion means setting five durations to zero.
- **In-house quiz** on the word page's SVG, with Hanzi Writer's stroke matcher (`strokeMatches` and its geometry helpers, about 200 lines of pure functions) ported under its MIT license.
- Matcher test, both options using the same code: the matcher run headless on our 3,143 HSK 2025 and GF0025-2021 characters (30,052 strokes, `data/hanzi-writer-data`), default leniency, synthetic strokes made from each median resampled to 6 points per segment.

| Stroke drawn | Result |
|---|---|
| The median itself | 100 % accepted |
| Median + Gaussian noise σ 15 units, shifted 28 units | 84.5 % accepted |
| Median + noise σ 35 units, shifted 72 units | 40.5 % accepted |
| Median reversed | 100 % rejected and flagged backwards |
| The next stroke's median instead | 100 % rejected |

### Input method

- **In-house** over our data: candidates are the CC-CEDICT headwords whose toneless reading matches the input, ranked by wordfreq. Test: the rank of each HSK 2025 word among the candidates of its full reading (10,896 readings).

| HSK 2025 band | Typed | Top 1 | Top 3 | Top 5 | First page (9) | Not offered |
|---|---|---|---|---|---|---|
| 1–3 (988) | toneless | 76.9 % | 93.4 % | 96.9 % | 98.8 % | 0 % |
| 1–3 | with tone numbers | 89.1 % | 98.8 % | 99.6 % | 100 % | 0 % |
| 4–6 (4,348) | toneless | 78.7 % | 92.0 % | 95.8 % | 98.7 % | 0 % |
| 4–6 | with tone numbers | 90.0 % | 97.9 % | 99.3 % | 100 % | 0 % |
| 7–9 (5,560) | toneless | 75.7 % | 91.8 % | 94.6 % | 97.6 % | 0 % |
| 7–9 | with tone numbers | 90.8 % | 97.2 % | 98.8 % | 99.8 % | 0 % |

  Single characters (1,505) typed toneless: 20.6 % top 1, 86.6 % on the first page; wordfreq counts a character used as a word, not inside compounds.
- **pinyin-ime 1.0.2** ([catcherinsky/pinyin-ime](https://github.com/catcherinsky/pinyin-ime), MIT, first published 2026-03, one maintainer, Lit web component). Its engine fed our data: 77.0 % top 1, 95.3 % top 5, 98.1 % first page, the in-house ranking's results; it adds prefix completion (`zhongguoren` offers 中国人民解放军). With its bundled "google" dictionary (103,385 entries, 4.3 MB): 73.6 %, 92.3 % and 95.0 %, 3.0 % of readings not offered; the dictionary's source and license are not stated, which `data/SOURCES.md` requires.
- Seen, not tested: simple-ime 1.2.4 (MIT, global keyboard hook, its own 1.6 MB dictionary and interface), jsh_rime 2.0.2 (Apache-2.0, RIME compiled to WebAssembly, 13 MB). Both bring their own interface and data.

### Accessibility (W3C Understanding documents, read 2026-10-16)

- [2.5.1 Pointer Gestures](https://www.w3.org/WAI/WCAG22/Understanding/pointer-gestures.html) (A): drawing a stroke is a path-based gesture, so it needs a single-pointer alternative without a path, unless the gesture is essential. Essential requires that the function "cannot be achieved in another way that would conform"; another way exists here, so the exception is not claimed.
- [2.5.7 Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) (AA): a keyboard equivalent alone does not meet it; the alternative must offer controls that can be clicked or tapped.
- [2.1.1 Keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html) (A): handwriting is a path-dependent input technique and exempt, the function behind it is not. The M4 exit criterion asks for a keyboard-only path anyway.
- [2.2.1 Timing Adjustable](https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html) (A): a time limit set by the content can be met by letting the user turn it off before encountering it.

## Decision

All choices below are the maintainer's, 2026-10-16.

- **Card types** `writing` and `typing` join `recognition`, `recall` and `tone`. Their subject is a word reading, like the other word cards; notes get neither. A settings pair "Practice: typing / handwriting" turns each on, typing on and handwriting off by default. An enabled card is created like the tone card: once its word is started, from the new-card budget, one card per word per learning day. A word is eligible for writing when every character has stroke data, for typing when the language pack has the `ime` feature. Turning a setting off hides its cards from sessions; the review log is untouched.
- **Writing quiz: in-house.** Hanzi Writer's matcher is ported to `packages/core` with its MIT notice, credited on the about page. The card shows meaning, pinyin and audio; the learner draws each character's strokes on the word page's 米 grid, without outline. Pointer Events with pointer capture and `touch-action: none`; a stroke is judged on release and dropped on `pointercancel` (SC 2.5.2). After three misses on a stroke its outline is shown as a hint, without motion under reduced motion. Grade: no miss is good, misses without a hint hard, any hint again; never easy, as with the tone card.
- **Single-pointer and keyboard alternative: write on paper, then self-grade.** A switch on the card ("Write on paper") remembers the choice as a setting. Space reveals each character's stroke order (the word page's stepper), keys 1–4 grade, as on a recall card. A stroke-order choice quiz was rejected: its choices show the character's shape, so it tests order, not recall.
- **Input method: in-house, over our data.** The `ime` capability (ADR 0003) is implemented in `lang-zh`: the input is split into pinyin syllables (every valid split, so `xian` is xian or xi'an; an apostrophe forces a split; `v` is ü), candidates come from CC-CEDICT readings through the dictionary's pinyin index; those covering more of the input come first, then by wordfreq. Committing a candidate consumes its syllables and leaves the rest of the input. A digit 1–5 after a syllable is its tone (5 neutral) and filters the candidates; tones stay optional; candidates are chosen with the arrow keys and Space or Enter, by click or tap. The field follows the ARIA combobox pattern; input composed by the system's own IME passes through. No new dataset or dependency.
- **Typing card**: meaning and audio shown, the learner types the characters; the headword typed exactly is good, anything else again, then the answer is shown with its pinyin.
- **Typing drill** (Learn): rounds of 10 started words, an optional timer off by default with an adjustable duration (SC 2.2.1), a result of words right and characters per minute. Drill answers are not reviews: they reach neither FSRS nor XP.

## Consequences

- No new runtime dependency; the matcher port carries Hanzi Writer's MIT notice.
- The card id scheme, backup format and future sync keep their shape; the backup schema accepts the two new types.
- A character shared by several words is written in each of their writing cards.
- The IME offers dictionary words only and has no sentence model; a phrase is typed word by word through partial commits.
- A CI data test keeps the IME's ranking at ≥ 97 % of HSK words on the first page, typed toneless.
- The writing and typing card variants and the drill are mocked up and approved before their UI code (ADR 0008).
