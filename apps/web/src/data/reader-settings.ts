import type { PresetSetting } from "./daily-goal.ts";

export const PINYIN_MODES = ["none", "unknown", "all"] as const;

export type PinyinMode = (typeof PINYIN_MODES)[number];

/** Pinyin above the characters, remembered; the unknown words only by default (ADR 0014). */
export const READER_PINYIN: PresetSetting<PinyinMode> = {
  key: "openlinguo.readerPinyin",
  values: PINYIN_MODES,
  fallback: "unknown",
};

/** Share of known words to reach, in percent: 98 % is Hu & Nation's (2000) unassisted reading. */
export const COVERAGE_TARGET: PresetSetting<number> = {
  key: "openlinguo.coverageTarget",
  values: [90, 95, 98, 99],
  fallback: 98,
};
