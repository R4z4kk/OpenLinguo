/** Recordings that still fail the speech-recognition check after every seed, validated by ear (`tts-packs review`). */
export const REVIEW_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Audio pack review</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 52rem; padding: 1rem; background: #fff; color: #111; }
  header { position: sticky; top: 0; z-index: 1; background: #fff; padding: .5rem 0; border-bottom: 1px solid #ccc; }
  section { border-bottom: 1px solid #ddd; padding: .75rem 0; display: grid; grid-template-columns: 1fr 1fr; gap: .25rem 1rem; align-items: center; }
  h2 { font-size: 1.5rem; margin: 0; }
  p { margin: 0; color: #333; }
  audio { width: 100%; }
  fieldset { border: 0; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: .25rem 1rem; }
  label { cursor: pointer; }
</style>
</head>
<body>
<header>
  <h1>Audio pack review</h1>
  <p>Speech recognition did not hear these words as written, with any seed. Does the audio say the word, nothing added or missing, with the tones shown? A rejected word ships without audio. Nothing plays by itself.</p>
  <p><span id="progress"></span> · <span id="status" role="status"></span></p>
</header>
<main id="items"></main>
<script>
let reviews = {};
let total = 0;
let timer = null;
const status = document.getElementById("status");
const progress = document.getElementById("progress");

const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

const updateProgress = () => {
  progress.textContent = Object.keys(reviews).length + " of " + total + " reviewed";
};

const save = () => {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      const response = await fetch("/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reviews),
      });
      status.textContent = response.ok ? "Saved" : "Save failed: HTTP " + response.status + " " + (await response.text());
    } catch (error) {
      status.textContent = "Save failed: " + error;
    }
  }, 300);
};

const start = async () => {
  try {
    const [items, saved] = await Promise.all(
      ["/items", "/reviews"].map(async (url) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(url + ": HTTP " + response.status + " " + (await response.text()));
        return response.json();
      }),
    );
    reviews = saved;
    total = items.length;
    const main = document.getElementById("items");
    for (const { id, key, word, spoken, transcript } of items) {
      const choice = (value, label) =>
        el("label", {}, [
          el("input", {
            type: "radio",
            name: id,
            value,
            checked: reviews[key] === value,
            onchange: () => {
              reviews[key] = value;
              updateProgress();
              save();
            },
          }),
          " " + label,
        ]);
      main.append(
        el("section", { ariaLabel: word }, [
          el("div", {}, [
            el("h2", { lang: "zh-CN", textContent: word }),
            el("p", { lang: "zh-Latn-pinyin", textContent: spoken }),
            el("p", { textContent: "Heard: " }, [el("span", { lang: "zh-CN", textContent: transcript })]),
          ]),
          el("audio", { controls: true, preload: "none", src: "/audio/" + id, ariaLabel: word }),
          el("fieldset", {}, [
            el("legend", { textContent: "Says the word?" }),
            choice("ok", "yes, ship it"),
            choice("bad", "no, no audio"),
          ]),
        ]),
      );
    }
    updateProgress();
  } catch (error) {
    status.textContent = "Could not load the review: " + error;
  }
};

start();
</script>
</body>
</html>
`;
