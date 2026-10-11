# Anki packages for tests

Small `.apkg` files written by Anki's own exporters, so the reader is tested against real packages of every format. Their notes are made up for the tests; nothing comes from AnkiWeb.

| File | Writer | Format |
| --- | --- | --- |
| `anki-26.09.3-latest.apkg` | `anki` 26.9.3 (PyPI) | Latest: `collection.anki21b`, zstd, protobuf media list |
| `anki-26.09.3-legacy2.apkg` | `anki` 26.9.3, "Support older Anki versions" | Legacy2 with `meta` |
| `anki-23.12.1-latest.apkg` | `anki` 23.12.1 | Latest |
| `anki-23.12.1-legacy2.apkg` | `anki` 23.12.1, "Support older Anki versions" | Legacy2 with `meta` |
| `anki-2.1.50-python-exporter.apkg` | `anki` 2.1.50, Python `AnkiPackageExporter` | Legacy2 without `meta` |
| `genanki-0.13.1.apkg` | `genanki` 0.13.1 | Legacy1: `collection.anki2` |
| `too-new.apkg` | Python `zipfile` | `meta` with version 4 only |
| `no-collection.apkg` | Python `zipfile` | `meta` with version 3 only |
| `corrupt-collection.apkg` | Python `zipfile` | version 3, `collection.anki21b` not zstd |

The Anki packages hold a "Chinese test" note type (Hanzi, Pinyin, Meaning, Audio) with eight notes, among them a missing sound, a script, an image and an unknown word, and a "Basic test" note type with one note, in the deck `HSK test::Level 1`. `nihao.wav` is a valid 0.2 s WAV; the other sounds are fake MP3 bytes.

## Regenerating

Anki 26.9.3 and genanki run in a local virtual environment; Anki 23.12.1 and 2.1.50 need Python 3.9 (`docker run --rm -v "$PWD:/work" -w /work python:3.9-slim`, with `protobuf==3.20.3` for 2.1.50).

```sh
pip install anki==26.9.3 genanki==0.13.1
python generate_anki.py out
python generate_genanki.py out
```

`generate_anki.py`:

```python
"""Writes small .apkg files with Anki's own exporter: python gen_fixtures.py <out-dir>."""
import io, math, os, shutil, sys, tempfile, wave

from anki.collection import Collection
import anki.buildinfo

try:
    from anki.collection import DeckIdLimit, ExportAnkiPackageOptions
except ImportError:  # Anki 2.1.50 only has the Python exporter (Legacy2 packages without meta).
    DeckIdLimit = ExportAnkiPackageOptions = None


def tone():
    """0.2 s of 440 Hz, 8 kHz mono 8-bit: a valid WAV every browser plays."""
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(1)
        w.setframerate(8000)
        w.writeframes(bytes(128 + int(60 * math.sin(2 * math.pi * 440 * i / 8000)) for i in range(1600)))
    return out.getvalue()


FAKE_MP3 = b"ID3\x03\x00\x00\x00\x00\x00\x00" + b"\xff\xfb\x90\x00" + bytes(200)

out = os.path.abspath(sys.argv[1])
version = anki.buildinfo.version
os.makedirs(out, exist_ok=True)
work = tempfile.mkdtemp()
col = Collection(os.path.join(work, "collection.anki2"))
mm = col.models


def notetype(name, fields, qfmt):
    m = mm.new(name)
    for field in fields:
        mm.add_field(m, mm.new_field(field))
    t = mm.new_template("Card 1")
    t["qfmt"] = qfmt
    t["afmt"] = "{{FrontSide}}<hr id=answer>"
    mm.add_template(m, t)
    mm.add(m)
    return mm.by_name(name)


chinese = notetype("Chinese test", ["Hanzi", "Pinyin", "Meaning", "Audio"], "{{Hanzi}}")
basic = notetype("Basic test", ["Front", "Back"], "{{Front}}")
deck = col.decks.id("HSK test::Level 1")

rows = [
    ("你好", "nǐ hǎo", "hello", "nihao.wav"),
    ("谢谢", "xie4 xie5", "thanks", "xiexie.mp3"),
    ("電話", "<span class=tone4>diàn</span><span class=tone4>huà</span>", "phone", "dianhua.mp3"),
    ("了", "", "particle", ""),
    ("<b>学习</b>&nbsp;", "xuéxí", "to study", "xuexi.mp3"),
    ("不存在词语", "bù cún zài", "made up", "fake.mp3"),
    ("<script>alert(1)</script>吃", "chī", "<img src=x.png onerror=alert(1)>eat", "chi.js"),
    ("中文", "Zhōngwén", "Chinese", "missing.mp3"),
]
for hanzi, pinyin, meaning, audio in rows:
    n = col.new_note(chinese)
    n["Hanzi"], n["Pinyin"], n["Meaning"] = hanzi, pinyin, meaning
    n["Audio"] = f"[sound:{audio}]" if audio else ""
    col.add_note(n, deck)
    if audio and audio != "missing.mp3":
        data = tone() if audio.endswith(".wav") else b"alert(1)" if audio.endswith(".js") else FAKE_MP3
        col.media.write_data(audio, data)
n = col.new_note(basic)
n["Front"], n["Back"] = "书", "book"
col.add_note(n, deck)
col.media.write_data("x.png", b"\x89PNG\r\n\x1a\n" + bytes(20))

if DeckIdLimit is None:
    from anki.exporting import AnkiPackageExporter

    exporter = AnkiPackageExporter(col)
    exporter.did = deck
    exporter.includeSched = False
    exporter.includeMedia = True
    exporter.exportInto(os.path.join(out, f"anki-{version}-python-exporter.apkg"))
else:
    for legacy in [False, True]:
        col.export_anki_package(
            out_path=os.path.join(out, f"anki-{version}-{'legacy2' if legacy else 'latest'}.apkg"),
            options=ExportAnkiPackageOptions(
                with_scheduling=False, with_deck_configs=False, with_media=True, legacy=legacy
            ),
            limit=DeckIdLimit(deck),
        )
col.close()
shutil.rmtree(work, ignore_errors=True)
print("anki", version, sorted(os.listdir(out)))
```

`generate_genanki.py`:

```python
"""Writes a Legacy1 package (collection.anki2, no meta) with genanki: python gen_legacy1.py <out-dir>."""
import os, sys, tempfile

import genanki

out = os.path.abspath(sys.argv[1])
model = genanki.Model(
    1607392319,
    "Chinese genanki",
    fields=[{"name": "Hanzi"}, {"name": "Pinyin"}, {"name": "Meaning"}, {"name": "Audio"}],
    templates=[{"name": "Card 1", "qfmt": "{{Hanzi}}", "afmt": "{{FrontSide}}<hr id=answer>{{Pinyin}}"}],
)
deck = genanki.Deck(2059400110, "Genanki deck")
deck.add_note(genanki.Note(model=model, fields=["你好", "nǐ hǎo", "hello", "[sound:nihao.mp3]"]))
deck.add_note(genanki.Note(model=model, fields=["谢谢", "xièxie", "thanks", ""]))
media = os.path.join(tempfile.mkdtemp(), "nihao.mp3")
with open(media, "wb") as f:
    f.write(b"ID3\x03\x00\x00\x00\x00\x00\x00" + b"\xff\xfb\x90\x00" + bytes(200))
package = genanki.Package(deck)
package.media_files = [media]
package.write_to_file(os.path.join(out, f"genanki-{genanki.__version__}.apkg"))
print("genanki", genanki.__version__)
```

The three broken packages:

```python
import zipfile

with zipfile.ZipFile("too-new.apkg", "w") as z:
    z.writestr("meta", bytes([8, 4]))
with zipfile.ZipFile("no-collection.apkg", "w") as z:
    z.writestr("meta", bytes([8, 3]))
with zipfile.ZipFile("corrupt-collection.apkg", "w") as z:
    z.writestr("meta", bytes([8, 3]))
    z.writestr("collection.anki21b", b"not zstd at all")
```
