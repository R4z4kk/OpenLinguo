import { test } from "vitest";
import { createSegmenter } from "./segment.ts";
import { loadCedictRows } from "./testing/dataset-shards.ts";

const sample =
  "研究生命的起源。结婚的和尚未结婚的。他说的确实在理。我想打电话给你。今天天气很好，我们去公园散步吧。中华人民共和国成立了。我买了很多东西。";
const text = Array.from(sample.repeat(Math.ceil(2_000 / Array.from(sample).length)))
  .slice(0, 2_000)
  .join("");

test("segments 2,000 characters", async ({ bench }) => {
  const segment = createSegmenter(
    new Set((await loadCedictRows()).map(([simplified]) => simplified)),
  );
  await bench("bidirectional maximum matching", () => {
    segment(text);
  }).run();
});
