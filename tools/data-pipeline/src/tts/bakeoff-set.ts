import { ok, type Result } from "@openlinguo/core";
import {
  applySandhi,
  parseNumbered,
  toDiacritic,
  type ReadingWord,
  type SandhiError,
} from "@openlinguo/lang-zh";

export type BakeoffCategory =
  | "syllable"
  | "tone-pair"
  | "third-tone"
  | "yi"
  | "bu"
  | "neutral"
  | "erhua"
  | "polyphone"
  | "sentence";

export type BakeoffItem = {
  readonly id: string;
  readonly category: BakeoffCategory;
  readonly text: string;
  readonly words: readonly ReadingWord[];
  readonly end: string;
};

const item = (
  id: string,
  category: BakeoffCategory,
  words: readonly (readonly [text: string, reading: string])[],
  end = "",
): BakeoffItem => ({
  id,
  category,
  text: words.map(([text]) => text).join("") + end,
  words: words.map(([text, reading]) => ({ text, reading })),
  end,
});

/** Readings are CC-CEDICT readings; the test checks each one against the dataset. */
export const BAKEOFF_SET: readonly BakeoffItem[] = [
  item("ma1", "syllable", [["妈", "ma1"]]),
  item("ma2", "syllable", [["麻", "ma2"]]),
  item("ma3", "syllable", [["马", "ma3"]]),
  item("ma4", "syllable", [["骂", "ma4"]]),
  item("tang1", "syllable", [["汤", "tang1"]]),
  item("tang2", "syllable", [["糖", "tang2"]]),
  item("tang3", "syllable", [["躺", "tang3"]]),
  item("tang4", "syllable", [["烫", "tang4"]]),
  item("lianxi-contact", "tone-pair", [["联系", "lian2 xi4"]]),
  item("lianxi-practice", "tone-pair", [["练习", "lian4 xi2"]]),
  item("zhuren-owner", "tone-pair", [["主人", "zhu3 ren2"]]),
  item("zhuren-director", "tone-pair", [["主任", "zhu3 ren4"]]),
  item("nihao", "third-tone", [["你好", "ni3 hao3"]]),
  item("laohu", "third-tone", [["老虎", "lao3 hu3"]]),
  item("zhanlanguan", "third-tone", [["展览馆", "zhan3 lan3 guan3"]]),
  item("wo-hen-hao", "third-tone", [
    ["我", "wo3"],
    ["很", "hen3"],
    ["好", "hao3"],
  ]),
  item("xiao-laohu", "third-tone", [
    ["小", "xiao3"],
    ["老虎", "lao3 hu3"],
  ]),
  item("yige", "yi", [["一个", "yi1 ge5"]]),
  item("yi-tian", "yi", [
    ["一", "yi1"],
    ["天", "tian1"],
  ]),
  item("yiqi", "yi", [["一起", "yi1 qi3"]]),
  item("diyi", "yi", [["第一", "di4 yi1"]]),
  item("bushi", "bu", [["不是", "bu4 shi4"]]),
  item("buhao", "bu", [["不好", "bu4 hao3"]]),
  item("budui", "bu", [["不对", "bu4 dui4"]]),
  item("mama", "neutral", [["妈妈", "ma1 ma5"]]),
  item("mai-dongxi", "neutral", [
    ["买", "mai3"],
    ["东西", "dong1 xi5"],
  ]),
  item("zhuozi", "neutral", [["桌子", "zhuo1 zi5"]]),
  item("xiexie", "neutral", [["谢谢", "xie4 xie5"]]),
  item("yidianr", "erhua", [["一点儿", "yi1 dian3 r5"]]),
  item("wanr", "erhua", [["玩儿", "wan2 r5"]]),
  item("yinhang", "polyphone", [["银行", "yin2 hang2"]]),
  item("zhangda", "polyphone", [["长大", "zhang3 da4"]]),
  item("changcheng", "polyphone", [["长城", "Chang2 cheng2"]]),
  item(
    "sentence-chifan",
    "sentence",
    [
      ["我们", "wo3 men5"],
      ["一起", "yi1 qi3"],
      ["去", "qu4"],
      ["吃饭", "chi1 fan4"],
      ["吧", "ba5"],
    ],
    "。",
  ),
  item(
    "sentence-laoshi",
    "sentence",
    [
      ["你", "ni3"],
      ["不是", "bu4 shi4"],
      ["老师", "lao3 shi1"],
      ["吗", "ma5"],
    ],
    "？",
  ),
  item(
    "sentence-shuiguo",
    "sentence",
    [
      ["我", "wo3"],
      ["想", "xiang3"],
      ["买", "mai3"],
      ["一点儿", "yi1 dian3 r5"],
      ["水果", "shui3 guo3"],
    ],
    "。",
  ),
];

/** Expected spoken pinyin with tone marks, after tone sandhi, one group per word. */
export const spokenPinyin = (item: BakeoffItem): Result<string, SandhiError> => {
  const spoken = applySandhi(item.words);
  if (!spoken.ok) return spoken;
  const words: string[] = [];
  for (const reading of spoken.value) {
    const marked = toDiacritic(reading);
    if (!marked.ok) return marked;
    words.push(marked.value.replaceAll(" ", ""));
  }
  return ok(words.join(" "));
};

/**
 * Tone-numbered pinyin for MOSS-TTS, in the pypinyin TONE3 form it was trained on: spoken tones after
 * sandhi, neutral tone without a digit, ü as v. Erhua keeps the character 儿, which MOSS reads inside pinyin,
 * because pypinyin's "er2" would be read as a full syllable.
 */
export const mossPinyin = (item: BakeoffItem): Result<string, SandhiError> => {
  const spoken = applySandhi(item.words);
  if (!spoken.ok) return spoken;
  const syllables: string[] = [];
  for (const reading of spoken.value) {
    const tokens = parseNumbered(reading);
    if (!tokens.ok) return tokens;
    for (const token of tokens.value) {
      if (token.kind === "other") continue;
      const letters = token.letters.toLowerCase().replaceAll("ü", "v");
      if (letters === "r" && token.tone === 5) syllables.push("儿");
      else syllables.push(token.tone === 5 ? letters : `${letters}${String(token.tone)}`);
    }
  }
  return ok(syllables.join(" ") + item.end);
};

const INITIALS = [
  "zh",
  "ch",
  "sh",
  "b",
  "p",
  "m",
  "f",
  "d",
  "t",
  "n",
  "l",
  "g",
  "k",
  "h",
  "j",
  "q",
  "x",
  "r",
  "z",
  "c",
  "s",
];

/** Initial and final as pypinyin's strict INITIALS / FINALS_TONE3 styles split them (no y or w initial). */
const strictParts = (letters: string): readonly [initial: string, final: string] => {
  const initial = INITIALS.find((candidate) => letters.startsWith(candidate)) ?? "";
  const rest = letters.slice(initial.length).replaceAll("ü", "v");
  if (initial === "") {
    if (rest.startsWith("yu")) return ["", `v${rest.slice(2)}`];
    if (rest.startsWith("yi")) return ["", rest.slice(1)];
    if (rest.startsWith("y")) return ["", `i${rest.slice(1)}`];
    if (rest === "wu") return ["", "u"];
    if (rest.startsWith("w")) return ["", `u${rest.slice(1)}`];
    return ["", rest];
  }
  if (["j", "q", "x"].includes(initial) && rest.startsWith("u"))
    return [initial, `v${rest.slice(1)}`];
  const full = rest === "iu" ? "iou" : rest === "ui" ? "uei" : rest === "un" ? "uen" : rest;
  if (["zh", "ch", "sh", "r"].includes(initial) && full === "i") return [initial, "iii"];
  if (["z", "c", "s"].includes(initial) && full === "i") return [initial, "ii"];
  return [initial, full];
};

/**
 * Phoneme tokens for GLM-TTS (`<|X|><|IAN2|>`, the form of its G2P_replace_dict), from the spoken tones after
 * sandhi. Erhua keeps the character 儿: the tokenizer has no neutral-tone ER token.
 */
export const glmPhonemes = (item: BakeoffItem): Result<string, SandhiError> => {
  const spoken = applySandhi(item.words);
  if (!spoken.ok) return spoken;
  let out = "";
  for (const reading of spoken.value) {
    const tokens = parseNumbered(reading);
    if (!tokens.ok) return tokens;
    for (const token of tokens.value) {
      if (token.kind === "other") continue;
      const letters = token.letters.toLowerCase();
      if (letters === "r" && token.tone === 5) {
        out += "儿";
        continue;
      }
      const [initial, final] = strictParts(letters);
      out +=
        (initial === "" ? "" : `<|${initial.toUpperCase()}|>`) +
        `<|${final.toUpperCase()}${String(token.tone)}|>`;
    }
  }
  return ok(out + item.end);
};
