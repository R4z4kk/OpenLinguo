# OpenLinguo

Open-source app to learn Mandarin Chinese, with the interface in French or English: [openlinguo.razakk.fr](https://openlinguo.razakk.fr).

It is local-first: you can learn offline, without an account, and your learning data stays on your device.

## What it does

- **Choose what to learn:** dictionary with HSK levels, words ranked by frequency, character decomposition and stroke order.
- **Remember it:** spaced repetition (FSRS), decks and Anki import.
- **Say it:** pinyin chart, tone training with pitch visualization, shadowing.
- **Write it:** handwriting and pinyin typing.
- **Read it:** graded reader with coverage of the words you know, for your own texts, AI stories and a moderated shared library.
- **Use it:** AI-assisted writing practice with your own key or a local server. Every AI output is a proposal you validate.

## Status

In production. Milestones M0 to M7 are done; next are sync between devices (M8), then the v1.0 hardening (M10). See the [roadmap](docs/ROADMAP.md), the [architecture decisions](docs/adr/) and the [milestones](https://github.com/R4z4kk/OpenLinguo/milestones).

## Other languages

The project focuses on Mandarin and plans no other language. The door stays open: each language is a package implementing the `LanguagePack` interface, checked by a shared contract test suite, and a capability such as tones or strokes can simply be absent ([ADR 0003](docs/adr/0003-languagepack-capabilities.md)).

`packages/lang-en` is the minimal example, used only by those tests. The app itself still calls the Mandarin pack directly, so adding a language to it also means wiring that pack through `apps/web`.

## Development

Node 24 and pnpm:

```bash
pnpm install
pnpm --filter @openlinguo/web dev
pnpm test
```

More in the [web app](apps/web/README.md) and [API](apps/api/README.md) READMEs.

## License

Code: [AGPL-3.0](LICENSE). Linguistic datasets keep their own licenses, listed in [`data/SOURCES.md`](data/SOURCES.md).
