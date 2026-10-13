/** Local comparison page served by `bakeoff.ts serve`; it reads /items and /picks and saves on every change. */
export const LISTENING_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TTS bake-off</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 52rem; padding: 1rem; background: #fff; color: #111; }
  header { position: sticky; top: 0; z-index: 1; background: #fff; padding: .5rem 0; border-bottom: 1px solid #ccc; }
  section { border-bottom: 1px solid #ddd; padding: 1rem 0; }
  h2 { font-size: 2rem; margin: 0; }
  .pinyin { font-size: 1.25rem; margin: 0; }
  .category { color: #555; margin: 0 0 .5rem; }
  .version { display: grid; grid-template-columns: 9rem 1fr; gap: .5rem; align-items: center; margin: .25rem 0; }
  audio { width: 100%; }
  fieldset { border: 1px solid #ccc; margin: .5rem 0; display: flex; flex-wrap: wrap; gap: .25rem 1rem; }
  label { cursor: pointer; }
  textarea { width: 100%; }
</style>
</head>
<body>
<header>
  <h1>TTS bake-off</h1>
  <p>Listen to the items you want, in any order. When one version stands out, pick it as the best (or "none is good"). Tones should follow the pinyin shown, sandhi included. Nothing plays by itself.</p>
  <p><span id="progress"></span> · <span id="status" role="status"></span></p>
</header>
<main id="items"></main>
<script>
const state = { picks: {}, notes: {} };
const status = document.getElementById("status");
const progress = document.getElementById("progress");
let timer = null;

const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

const updateProgress = () => {
  progress.textContent = Object.keys(state.picks).length + " items with a pick";
};

const save = () => {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      const response = await fetch("/picks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      status.textContent = response.ok ? "Saved" : "Save failed: HTTP " + response.status + " " + (await response.text());
    } catch (error) {
      status.textContent = "Save failed: " + error;
    }
  }, 300);
};

const render = ({ engines, items }) => {
  const main = document.getElementById("items");
  for (const item of items) {
    const versions = engines.map((engine) =>
      el("div", { className: "version" }, [
        el("span", { textContent: engine }),
        el("audio", { controls: true, preload: "none", src: "/audio/" + item.id + "/" + engine, ariaLabel: item.text + ", " + engine }),
      ]),
    );
    const choice = (value, text) =>
      el("label", {}, [
        el("input", {
          type: "radio",
          name: item.id + "-best",
          value,
          checked: state.picks[item.id] === value,
          onchange: () => {
            state.picks[item.id] = value;
            updateProgress();
            save();
          },
        }),
        " " + text,
      ]);
    const note = el("textarea", {
      rows: 2,
      value: state.notes[item.id] ?? "",
      oninput: (event) => {
        state.notes[item.id] = event.target.value;
        save();
      },
    });
    main.append(
      el("section", { ariaLabel: item.text }, [
        el("h2", { lang: "zh-CN", textContent: item.text }),
        el("p", { className: "pinyin", lang: "zh-Latn-pinyin", textContent: item.spoken }),
        el("p", { className: "category", textContent: item.category }),
        ...versions,
        el("fieldset", {}, [
          el("legend", { textContent: "Best version" }),
          ...engines.map((engine) => choice(engine, engine)),
          choice("none", "none is good"),
        ]),
        el("label", {}, ["Note (optional)", note]),
      ]),
    );
  }
  updateProgress();
};

const start = async () => {
  try {
    const [data, saved] = await Promise.all(
      ["/items", "/picks"].map(async (url) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(url + ": HTTP " + response.status + " " + (await response.text()));
        return response.json();
      }),
    );
    state.picks = saved.picks;
    state.notes = saved.notes;
    render(data);
  } catch (error) {
    status.textContent = "Could not load the bake-off: " + error;
  }
};

start();
</script>
</body>
</html>
`;

/** Flashcards heard as a learner would: the word, a pause, then a sentence containing it (`bakeoff.ts serve`, /mix). */
export const MIX_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TTS mix</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 52rem; padding: 1rem; background: #fff; color: #111; }
  section { border-bottom: 1px solid #ddd; padding: 1rem 0; }
  h2 { font-size: 2rem; margin: 0; }
  .pinyin { margin: 0 0 .5rem; color: #333; }
  .version { display: grid; grid-template-columns: 16rem 1fr; gap: .5rem; align-items: center; margin: .25rem 0; }
  audio { width: 100%; }
</style>
</head>
<body>
<h1>TTS mix</h1>
<p>Each card plays a word, a short pause, then a sentence containing it. Compare the GLM-TTS word followed by the MOSS-TTS sentence with MOSS-TTS for both. Nothing plays by itself.</p>
<p id="status" role="status"></p>
<main id="cards"></main>
<script>
const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

const start = async () => {
  try {
    const response = await fetch("/mix/cards");
    if (!response.ok) throw new Error("/mix/cards: HTTP " + response.status + " " + (await response.text()));
    const main = document.getElementById("cards");
    for (const card of await response.json()) {
      const version = (label, engine) =>
        el("div", { className: "version" }, [
          el("span", { textContent: label }),
          el("audio", { controls: true, preload: "none", src: "/mix/audio/" + card.word + "/" + engine, ariaLabel: card.wordText + ", " + label }),
        ]);
      main.append(
        el("section", { ariaLabel: card.wordText }, [
          el("h2", { lang: "zh-CN", textContent: card.wordText }),
          el("p", { className: "pinyin", lang: "zh-Latn-pinyin", textContent: card.wordSpoken + " · " + card.sentenceText + " " + card.sentenceSpoken }),
          version("GLM word + MOSS sentence", "glm"),
          version("MOSS word + MOSS sentence", "moss"),
        ]),
      );
    }
  } catch (error) {
    document.getElementById("status").textContent = "Could not load the mix: " + error;
  }
};

start();
</script>
</body>
</html>
`;
