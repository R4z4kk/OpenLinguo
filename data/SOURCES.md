# Data sources and licenses

Checked on primary sources on 2026-10-09 (issue #8). Once a dataset is imported, its exact version, retrieval date, sha256 and maximum age live in `data/manifest.json`; this file records what may be used and under which obligations.

Code is AGPL-3.0. Datasets keep their own licenses. Share-alike datasets combined together (CC-CEDICT 4.0 + CFDICT 3.0 + Wiktionary) are distributed under **CC BY-SA 4.0** (BY-SA 3.0 allows adaptations under a later version).

## Datasets shipped in the app

| Dataset | Used for | License | Source | Status |
|---|---|---|---|---|
| CC-CEDICT | zh dictionary, EN glosses | CC BY-SA 4.0 | [mdbg.net](https://www.mdbg.net/chinese/dictionary?page=cc-cedict) | Verified — 125,244 entries, release 2026-10-09 |
| CFDICT | zh dictionary, FR glosses | CC BY-SA 3.0 | [chine.in](https://chine.in/chinois/open/CFDICT/) | Verified — official file (re-checked 2026-10-09): 56,300 entries, 101,235 French translations, version 2024-12-14 in the file header (the page's "240,487 translations" is not what the download contains) |
| HSK 2025 exam syllabus (新版HSK考试大纲) | zh levels 1–6 and 7-9 | Official exam standard; word→level and char→level facts only | Official PDF on [chinesetest.cn](https://www.chinesetest.cn) (copy-protected); imported from the transcription [harukicoder/hsk30](https://github.com/harukicoder/hsk30) at a pinned commit | Verified with limits — see note below |
| GF0025-2021 national standard (国际中文教育中文水平等级标准) | zh levels 1–6 and 7-9, free referential and fallback | Official standard of the Ministry of Education and State Language Commission; word→level and char→level facts only | Unrestricted official PDF on [moe.gov.cn](http://www.moe.gov.cn/jyb_xwfb/gzdt_gzdt/s5987/202103/t20210329_523304.html) (scanned); imported from the OCR [elkmovie/hsk30](https://github.com/elkmovie/hsk30) (Pleco Inc., MIT) at a pinned commit | Verified — exact counts, see note below |
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
- The official PDF (406 pages, sha256 `ec74ce04…504941`) is encrypted with permissions that allow printing and accessibility extraction only (`/P -1340`, copy and extraction disabled). Extracting it ourselves would bypass a technical protection measure (CPI L.331-5), so it is not parsed (decision 2026-10-09).
- Levels come from the transcription [harukicoder/hsk30](https://github.com/harukicoder/hsk30) (MIT, created 2026-09-01) pinned at commit `36c0d11`, which extracted the PDF and validated its per-level entry counts against the published totals (300 / 500 / 1,000 / 2,000 / 3,600 / 5,400 / 11,000).
- What we verify ourselves: 3,088 recognition characters with the per-level counts 246 / 125 / 284 / 441 / 431 / 413 / 1,148; 10,896 distinct words (the 11,000 entries include homographs); levels 1–7 with the lowest level kept; every graded reading exists in CC-CEDICT. The exact per-level entry totals cannot be recomputed from the collapsed transcription.
- The transcription's pinyin is truncated for some words (下雨 → `xià`); it is only used to choose between CC-CEDICT readings of polyphones, and unresolved words are listed in `data/hsk-2025-words/issues.tsv`.
- Permission to extract and redistribute the word → level and character → level facts has been requested from CTI (kaoshi@chinesetest.cn). If granted, the pipeline switches to the official PDF with exact validation.
- The GF0025-2021 national standard (Ministry of Education PDF, no restriction, scanned pages) is a different list: 41.5% of shared words change level in the 2025 syllabus, so it is not used for exam levels.
- Only the factual word→level and character→level mapping is stored, with attribution. No editorial content, tasks, topics or grammar material is reproduced. Takedown on request from the issuing body.

### GF0025-2021 standard

- Shipped next to the 2025 syllabus as a free referential (decision 2026-10-09): the official PDF has no restriction, and as an administrative document of state organs it is likely outside copyright (Copyright Law of the PRC, art. 5; not legal advice). It is also the fallback if CTI asks for the 2025 levels to be removed (#56).
- The OCR is verified exactly against the standard: 500 / 772 / 973 / 1,000 / 1,071 / 1,140 / 5,636 words (11,092 entries, 10,954 headwords once variants and homographs are merged), 3,000 recognition characters (6 × 300 + 1,200), 1,200 handwriting characters (300 / 400 / 500), contiguous numbering. One OCR-misread index (1856 for 1836) is repaired and listed in `data/gf0025-2021-words/repairs.tsv`.
- The list has no pinyin: 404 polyphones get the level on every reading and are listed in `issues.tsv`.
- It is not the exam list: only 58.5% of the words shared with the 2025 syllabus keep the same level.

### CEFR-J

- The terms grant free research and commercial use, and modification, "with a proper acknowledgement of the source". Citation is therefore mandatory and is kept.
- Redistribution inside an open-source app is not addressed. The maintainer accepts this residual risk (decision 2026-10-09). Fallback if challenged: frequency-derived A1–B2 levels + Octanove C1/C2.

### CFDICT

- A 2016 Pleco forum post questions the provenance of some unofficial CFDICT versions; only the official download is used.
- The official XML has 42 corrupted bytes (stray 0xC2 lead bytes, one broken check mark) and 2 empty glosses; the pipeline repairs exactly these defects and lists them in `data/cfdict/repairs.tsv`, any other invalid byte fails the build. The `.u8` export silently drops the same apostrophes, so it is not used.
- French glosses are attached to CC-CEDICT entries (47,668 keys: exact match, traditional form stored as simplified, neutral-tone difference, or a tone conflict with a single candidate, CC-CEDICT tone kept and listed in `data/cfdict/tone-conflicts.tsv`). The 8,162 words CC-CEDICT lacks become French-only dictionary entries, searchable but not used for segmentation. 38 entries with an invalid pinyin are listed in `data/cfdict/rejected.tsv`.

## Attribution (About page)

- CC-CEDICT — MDBG, CC BY-SA 4.0
- CFDICT — Chine Informations (chine.in), CC BY-SA 3.0
- HSK 2025 exam syllabus levels — Center for Language Education and Cooperation / Chinese Testing International (transcription: harukicoder/hsk30, MIT)
- GF0025-2021 standard levels — Ministry of Education and State Language Commission of the PRC (OCR: Pleco Inc. via elkmovie/hsk30, MIT)
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
