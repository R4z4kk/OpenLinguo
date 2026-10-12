/** Local grading page served by `bakeoff.ts serve`; it reads /items and /grades and saves on every change. */
export const LISTENING_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TTS bake-off</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 52rem; padding: 1rem; background: #fff; color: #111; }
  header { position: sticky; top: 0; background: #fff; padding: .5rem 0; border-bottom: 1px solid #ccc; }
  section { border-bottom: 1px solid #ddd; padding: 1rem 0; }
  h2 { font-size: 2rem; margin: 0; }
  .pinyin { font-size: 1.25rem; margin: 0; }
  .category { color: #555; margin: 0 0 .5rem; }
  fieldset { border: 1px solid #ccc; margin: .5rem 0; }
  audio { width: 100%; }
  .row { display: flex; flex-wrap: wrap; gap: .25rem 1rem; align-items: center; margin-top: .25rem; }
  label { cursor: pointer; }
  textarea { width: 100%; }
  .missing { outline: 2px solid #b00; }
</style>
</head>
<body>
<header>
  <h1>TTS bake-off</h1>
  <p>Listen to every version, then grade it: are the tones right (as written in the pinyin, sandhi included), and how natural does it sound? The engines are hidden and their order changes from one item to the next. Nothing plays by itself.</p>
  <p><span id="progress"></span> · <span id="status" role="status"></span></p>
</header>
<main id="items"></main>
<script>
const state = { grades: new Map(), notes: {} };
const status = document.getElementById("status");
const progress = document.getElementById("progress");
let total = 0;
let timer = null;

const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

const radio = (name, value, text, checked, onChange) =>
  el("label", {}, [el("input", { type: "radio", name, value, checked, onchange: onChange }), " " + text]);

const updateProgress = () => {
  const done = [...state.grades.values()].filter((g) => g.tonesRight !== null && g.naturalness !== null).length;
  progress.textContent = done + " of " + total + " versions graded";
};

const save = () => {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const grades = [...state.grades.values()].filter((g) => g.tonesRight !== null && g.naturalness !== null);
    try {
      const response = await fetch("/grades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grades, notes: state.notes }),
      });
      status.textContent = response.ok ? "Saved" : "Save failed: HTTP " + response.status + " " + (await response.text());
    } catch (error) {
      status.textContent = "Save failed: " + error;
    }
  }, 300);
};

const render = (items) => {
  const main = document.getElementById("items");
  for (const item of items) {
    const versions = item.labels.map((label) => {
      const key = item.id + "\\t" + label;
      const grade = state.grades.get(key) ?? { item: item.id, label, tonesRight: null, naturalness: null };
      state.grades.set(key, grade);
      total += 1;
      const change = (field, value) => () => {
        grade[field] = value;
        updateProgress();
        save();
      };
      const name = item.id + "-" + label;
      return el("fieldset", {}, [
        el("legend", { textContent: "Version " + label }),
        el("audio", { controls: true, preload: "none", src: "/audio/" + item.id + "/" + label }),
        el("div", { className: "row", role: "radiogroup", ariaLabel: "Version " + label + ": tones" }, [
          "Tones right?",
          radio(name + "-tones", "yes", "Yes", grade.tonesRight === true, change("tonesRight", true)),
          radio(name + "-tones", "no", "No", grade.tonesRight === false, change("tonesRight", false)),
        ]),
        el("div", { className: "row", role: "radiogroup", ariaLabel: "Version " + label + ": naturalness" }, [
          "Naturalness (1 robotic, 5 native):",
          ...[1, 2, 3, 4, 5].map((n) =>
            radio(name + "-natural", String(n), String(n), grade.naturalness === n, change("naturalness", n)),
          ),
        ]),
      ]);
    });
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
        el("label", {}, ["Note (optional)", note]),
      ]),
    );
  }
  updateProgress();
};

const start = async () => {
  try {
    const [items, saved] = await Promise.all(
      ["/items", "/grades"].map(async (url) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(url + ": HTTP " + response.status);
        return response.json();
      }),
    );
    for (const grade of saved.grades) state.grades.set(grade.item + "\\t" + grade.label, grade);
    state.notes = saved.notes;
    render(items);
  } catch (error) {
    status.textContent = "Could not load the bake-off: " + error;
  }
};

start();
</script>
</body>
</html>
`;
