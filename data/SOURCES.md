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
| Make Me a Hanzi `dictionary.txt` | zh character decomposition, radicals, etymology hints | LGPL-3.0-or-later | [skishore/makemeahanzi](https://github.com/skishore/makemeahanzi/blob/master/COPYING) | Verified — imported from commit `bddc96d` (9,574 characters), see note below |
| hanzi-writer-data 2.0.1 | zh stroke order (derived from Make Me a Hanzi `graphics.txt`) | Arphic Public License | [chanind/hanzi-writer-data](https://github.com/chanind/hanzi-writer-data) (`ARPHICPL.TXT`, `APL/`) | Verified — npm tarball 2.0.1, HSK 2025 + GF0025-2021 subset (3,143 characters), `ARPHICPL.TXT` shipped with the data, see note below |
| French Wiktionary, Chinese entries (`wiktionary-fr-zh`) | zh dictionary, extra FR glosses | CC BY-SA 4.0 (fr.wiktionary footer checked 2026-10-09) | [kaikki.org](https://kaikki.org/frwiktionary/Chinois/index.html) | Verified — extraction 2026-10-02 from the 2026-10-01 dump, 33,650 entries, see note below |
| Wiktionary extracts | en dictionary, FR translations, IPA (M9) | CC BY-SA 4.0 (Wiktionary is dual CC BY-SA 4.0 / GFDL; we use CC BY-SA 4.0) | [kaikki.org](https://kaikki.org/dictionary/rawdata.html) | Verified — latest extraction 2026-10-03 from the 2026-09-02 dump |
| wordfreq data | en/zh frequency ranking | CC BY-SA 4.0 (code Apache-2.0) | [rspeer/wordfreq](https://github.com/rspeer/wordfreq) | Verified — frozen project (see `SUNSET.md`), treated as a frozen dataset; Chinese list imported from commit `912caf6` (88,668 of 130,510 dictionary headwords have a frequency), see note below |
| CEFR-J Wordlist 1.6 | en levels A1–B2 (M9) | Free for research and commercial use **with citation**; redistribution not addressed | [cefr-j.org](https://www.cefr-j.org/download.html) | Verified with accepted risk — see note below |
| Octanove Vocabulary Profile C1/C2 | en levels C1–C2 (M9) | CC BY-SA 4.0 | [olp-en-cefrj](https://github.com/openlanguageprofiles/olp-en-cefrj) | Verified |
| Tatoeba sentences (text only) | example sentences | CC BY 2.0 FR (part also CC0 1.0) | [tatoeba.org/downloads](https://tatoeba.org/en/downloads) | Verified — audio excluded (per-contributor licenses, empty license = no reuse) |

## Fonts

All OFL-1.1 without Reserved Font Name (checked on each `OFL.txt` 2026-10-09), so subsets may keep their names. Served from the project origin only; the license text ships next to each font.

| Font | Used for | Source | Shipped as |
|---|---|---|---|
| Atkinson Hyperlegible Next (Braille Institute) | Latin interface | npm `@fontsource-variable/atkinson-hyperlegible-next` 5.3.0 | Variable WOFF2, Latin and Latin Extended |
| Noto Sans SC 400 and 700 (Adobe, Google) | Chinese interface, pinyin | [notofonts/noto-cjk](https://github.com/notofonts/noto-cjk) at commit `f8d1575` (`Sans/SubsetOTF/SC`) | `data/font-noto-sans-sc-400`, `data/font-noto-sans-sc-700`: 40 slices each, HSK 1 slice 39 KB |
| LXGW WenKai GB v1.522 (LXGW, from Klee One by Fontworks) | Display characters | [lxgw/LxgwWenkaiGB](https://github.com/lxgw/LxgwWenkaiGB/releases/tag/v1.522) | `data/font-lxgw-wenkai-gb`: 40 slices, HSK 1 slice 51 KB |

- The CJK fonts are split by `tools/data-pipeline` (subset-font, HarfBuzz) into slices ordered by HSK 2025 band, then GF0025-2021, then the other characters of the shipped datasets by frequency. Dataset characters a font lacks (93 for Noto Sans SC, 40 for WenKai GB, all rare) are listed in each `missing.tsv` and fall back to the next font.
- OpenType alternates (vertical, full-width and proportional forms) are dropped: horizontal simplified Chinese only. This divides the Latin and punctuation slices by 3 to 4.
- An HSK 1 page (its 246 characters, punctuation and pinyin) loads 67 KB of Noto Sans SC and 51 KB of WenKai GB; the slices published on npm (frequency order) would load 368 KB and 587 KB.

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
- French glosses are attached to CC-CEDICT entries (47,671 keys: exact match, traditional form stored as simplified, neutral-tone difference, or a tone conflict with a single candidate, CC-CEDICT tone kept and listed in `data/cfdict/tone-conflicts.tsv`). A toneless syllable (`a`, erhua `r`) is the neutral tone. The 8,154 words CC-CEDICT lacks become French-only dictionary entries, searchable but not used for segmentation. 40 entries with an invalid pinyin or a space inside the headword are listed in `data/cfdict/rejected.tsv`.

### French Wiktionary

- Second source of hand-written French glosses (#55); no pivot language, no AI. Same join policy as CFDICT: 6,970 CC-CEDICT keys glossed (1,288 of them without a CFDICT gloss), 1,203 French-only entries. Both sources are kept side by side; the app shows the source of each gloss.
- The extract has no date inside, so its version is the start of its sha256; `kaikki.org` only publishes a moving latest URL.
- The first pinyin reading of each entry is used (1,327 entries have several, listed). Sinogram sections are skipped (61% of their glosses are wiki notes such as HSK levels or stroke counts). Entries without pinyin (889), with an invalid pinyin (85) or a title that is not only Chinese characters (44) are left out, and 27 multi-line glosses (wiki examples) are dropped; all are listed in `data/wiktionary-fr-zh/issues.tsv`, never guessed.

### Make Me a Hanzi and hanzi-writer-data

- `dictionary.txt` is LGPL-3.0-or-later and derived from Unihan: `data/makemeahanzi/` ships the project's `LGPL` file (Unicode notice + LGPL-3.0) and the GPL-3.0 text the LGPL incorporates, and its README states that the data has been modified (Unicode notice, condition c). All 9,574 characters are kept (decomposition, radical, etymology); `definition`, `pinyin` and `matches` are dropped.
- Stroke data comes from the immutable npm tarball `hanzi-writer-data@2.0.1` (sha256 pinned), read with an in-house tar reader; `ARPHICPL.TXT` is copied from the same tarball. Only the characters of the two shipped referentials are kept: all 3,088 HSK 2025 and 3,000 GF0025-2021 characters (3,143 distinct) have stroke data, missing ones would be listed in `data/hanzi-writer-data/missing.tsv`. Served from the project origin, never from the jsDelivr CDN: imported into IndexedDB with the dictionary (`strokes.json`, 8.3 MB), with `ARPHICPL.TXT` published next to it in `/data/licenses/` and linked from the About page (as are the Make Me a Hanzi LGPL and GPL texts).

### wordfreq

- Only the large Chinese list (`wordfreq/data/large_zh.msgpack.gz`) is used, pinned at commit `912caf6`, the last data release of the frozen project; it is decoded by an in-house MessagePack reader (no new dependency). The Chinese list combines Wikipedia, OpenSubtitles 2018, SUBTLEX-CH, NewsCrawl and GlobalVoices, Google Books Ngrams, OSCAR, Twitter and the Jieba word list; the dataset README credits each of them (SUBTLEX-CH must be credited and stay identified as free data).
- Each bucket becomes a Zipf frequency (log10 of the occurrences per billion words), kept only for the simplified headwords of CC-CEDICT, CFDICT and French Wiktionary: 88,668 of 130,510 headwords. The dictionary search ranks results by exact match, then level, then this frequency (#26).
- The frequency belongs to a written form: every reading of a polyphone shares it, the level tells the readings apart. wordfreq segments Chinese with Jieba, so a word Jieba splits has no frequency (32 of the 10,896 HSK 2025 words, such as 不客气 or 有的); it ranks after the words of its level that have one.
- The wordfreq README asks that conversions keep the attribution and license with the data: the shards carry them in their README, and the dictionary page credits wordfreq next to the results.

## Attribution (About page)

- CC-CEDICT — MDBG, CC BY-SA 4.0
- CFDICT — Chine Informations (chine.in), CC BY-SA 3.0
- HSK 2025 exam syllabus levels — Center for Language Education and Cooperation / Chinese Testing International (transcription: harukicoder/hsk30, MIT)
- GF0025-2021 standard levels — Ministry of Education and State Language Commission of the PRC (OCR: Pleco Inc. via elkmovie/hsk30, MIT)
- Fonts — Atkinson Hyperlegible Next (Braille Institute), Noto Sans SC (Adobe, Google), LXGW WenKai GB (LXGW; Klee One by Fontworks), SIL Open Font License 1.1
- Make Me a Hanzi — Shaunak Kishore, LGPL-3.0, with Unihan data © Unicode, Inc.; stroke data from hanzi-writer-data (David Chanin), © Arphic Technology, Arphic Public License
- Wiktionary contributors (English and French Wiktionary) via Wiktextract (Tatu Ylonen, LREC 2022) and kaikki.org, CC BY-SA 4.0
- wordfreq — Robyn Speer, CC BY-SA 4.0; Chinese list from Wikipedia, OpenSubtitles 2018, SUBTLEX-CH (Cai and Brysbaert, 2010), NewsCrawl, GlobalVoices, Google Books Ngrams, OSCAR, Twitter and the Jieba word list
- CEFR-J Wordlist Version 1.6 — compiled by Yukio Tono, Tokyo University of Foreign Studies
- Octanove Vocabulary Profile — CC BY-SA 4.0
- Tatoeba sentences — tatoeba.org contributors, CC BY 2.0 FR

## Excluded

- Commercial graded readers.
- Any non-commercial (NC) licensed content.
- Tatoeba audio.
