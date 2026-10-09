# Data sources and licenses

Checked on primary sources on 2026-10-09 (issue #8). Once a dataset is imported, its exact version, retrieval date, sha256 and maximum age live in `data/manifest.json`; this file records what may be used and under which obligations.

Code is AGPL-3.0. Datasets keep their own licenses. Share-alike datasets combined together (CC-CEDICT 4.0 + CFDICT 3.0 + Wiktionary) are distributed under **CC BY-SA 4.0** (BY-SA 3.0 allows adaptations under a later version).

## Datasets shipped in the app

| Dataset | Used for | License | Source | Status |
|---|---|---|---|---|
| CC-CEDICT | zh dictionary, EN glosses | CC BY-SA 4.0 | [mdbg.net](https://www.mdbg.net/chinese/dictionary?page=cc-cedict) | Verified — 125,244 entries, release 2026-10-09 |
| CFDICT | zh dictionary, FR glosses | CC BY-SA 3.0 | [chine.in](https://chine.in/chinois/open/CFDICT/) | Verified — 240,487 translations announced; no file date published, the pipeline dates it from the per-entry modification timestamps in the XML |
| HSK 2025 exam syllabus (新版HSK考试大纲) | zh levels 1–9 | Official exam standard; word→level and char→level facts only | [chinesetest.cn](https://www.chinesetest.cn) → `新版HSK考试大纲1219.pdf` | Verified — see note below |
| Make Me a Hanzi `dictionary.txt` | zh character decomposition, radicals, etymology hints | LGPL-3.0-or-later | [skishore/makemeahanzi](https://github.com/skishore/makemeahanzi/blob/master/COPYING) | Verified |
| hanzi-writer-data 2.0.1 | zh stroke order (derived from Make Me a Hanzi `graphics.txt`) | Arphic Public License | [chanind/hanzi-writer-data](https://github.com/chanind/hanzi-writer-data) (`ARPHICPL.TXT`, `APL/`) | Verified — ship `ARPHICPL.TXT` with the data |
| Wiktionary extracts | en dictionary, FR translations, IPA (M9) | CC BY-SA 4.0 (Wiktionary is dual CC BY-SA 4.0 / GFDL; we use CC BY-SA 4.0) | [kaikki.org](https://kaikki.org/dictionary/rawdata.html) | Verified — latest extraction 2026-10-03 from the 2026-09-02 dump |
| wordfreq data | en/zh frequency ranking | CC BY-SA 4.0 (code Apache-2.0) | [rspeer/wordfreq](https://github.com/rspeer/wordfreq) | Verified — frozen project (see `SUNSET.md`), treated as a frozen dataset |
| CEFR-J Wordlist 1.6 | en levels A1–B2 (M9) | Free for research and commercial use **with citation**; redistribution not addressed | [cefr-j.org](https://www.cefr-j.org/download.html) | Verified with accepted risk — see note below |
| Octanove Vocabulary Profile C1/C2 | en levels C1–C2 (M9) | CC BY-SA 4.0 | [olp-en-cefrj](https://github.com/openlanguageprofiles/olp-en-cefrj) | Verified |
| Tatoeba sentences (text only) | example sentences | CC BY 2.0 FR (part also CC0 1.0) | [tatoeba.org/downloads](https://tatoeba.org/en/downloads) | Verified — audio excluded (per-contributor licenses, empty license = no reuse) |

## Libraries embedding data

| Package | Version checked | License |
|---|---|---|
| pitchy | 4.1.0 | MIT |
| hanzi-writer | 3.7.3 | MIT |
| opencc-js | 1.4.2 | MIT AND Apache-2.0 (OpenCC dictionaries) |
| ts-fsrs | 5.4.2 | MIT |

## TTS models (offline pipeline; generated audio is shipped)

| Model | Language | License | Status |
|---|---|---|---|
| Kokoro-82M | en | Apache-2.0 | Verified — zh voices rejected (graded D) |
| Fun-CosyVoice3-0.5B-2512 | zh candidate | Apache-2.0 (weights tag); the model card's "academic purposes only" disclaimer refers to its demo content | Verified |
| MeloTTS-Chinese | zh candidate | MIT (code and weights) | Verified |

## Notes

### HSK 2025 syllabus

- The syllabus was published by the Center for Language Education and Cooperation and Chinese Testing International (CTI) in November 2025. CTI announced the worldwide launch of the HSK 3.0 exam on **2026-12-13** (official HSKTestOfficial account, September 2026); trial sittings ran in January and September 2026.
- The pipeline downloads the official PDF (pinned URL + sha256) and extracts levels itself. Extraction must reproduce the syllabus's published cumulative totals: 300 / 500 / 1,000 / 2,000 / 3,600 / 5,400 / 11,000 entries; 3,088 recognition characters.
- The third-party transcription [harukicoder/hsk30](https://github.com/harukicoder/hsk30) (MIT, created 2026-09-01) is only used to cross-check our extraction, never as a source.
- Only the factual word→level and character→level mapping is stored, with attribution. No editorial content, tasks, topics or grammar material is reproduced. Takedown on request from the issuing body.

### CEFR-J

- The terms grant free research and commercial use, and modification, "with a proper acknowledgement of the source". Citation is therefore mandatory and is kept.
- Redistribution inside an open-source app is not addressed. The maintainer accepts this residual risk (decision 2026-10-09). Fallback if challenged: frequency-derived A1–B2 levels + Octanove C1/C2.

### CFDICT

- A 2016 Pleco forum post questions the provenance of some unofficial CFDICT versions; only the official download is used.

## Attribution (About page)

- CC-CEDICT — MDBG, CC BY-SA 4.0
- CFDICT — Chine Informations (chine.in), CC BY-SA 3.0
- HSK 2025 exam syllabus levels — Center for Language Education and Cooperation / Chinese Testing International
- Make Me a Hanzi — Shaunak Kishore, LGPL-3.0; stroke data © Arphic Technology, Arphic Public License
- Wiktionary contributors via Wiktextract (Tatu Ylonen, LREC 2022) and kaikki.org, CC BY-SA 4.0
- wordfreq — Robyn Speer, CC BY-SA 4.0
- CEFR-J Wordlist Version 1.6 — compiled by Yukio Tono, Tokyo University of Foreign Studies
- Octanove Vocabulary Profile — CC BY-SA 4.0
- Tatoeba sentences — tatoeba.org contributors, CC BY 2.0 FR

## Excluded

- Commercial graded readers.
- Any non-commercial (NC) licensed content.
- Tatoeba audio.
