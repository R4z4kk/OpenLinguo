// Spelling: 汉语拼音方案 (1958), https://zh.wikisource.org/wiki/汉语拼音方案
// IPA, places and manners: W.-S. Lee & E. Zee (2003), "Standard Chinese (Beijing)",
// JIPA 33(1), 109–112, https://doi.org/10.1017/S0025100303001208
// Syllables: the CC-CEDICT readings (pinyin-chart.test.ts), plus ê.

export type Place =
  "bilabial" | "labiodental" | "denti-alveolar" | "post-alveolar" | "alveolo-palatal" | "velar";

export type Manner =
  | "plosive"
  | "aspirated-plosive"
  | "affricate"
  | "aspirated-affricate"
  | "fricative"
  | "nasal"
  | "lateral"
  | "approximant";

export type PinyinInitial = {
  readonly letters: string;
  readonly ipa: string;
  /** Retroflex notation of Chao (1968), as cited in Lee & Zee's notes 2 and 3. */
  readonly chaoIpa: string | null;
  readonly place: Place;
  readonly manner: Manner;
  /** Syllable the initial is named by when said alone (玻 bo, 知 zhi…). */
  readonly reading: string;
};

export type FinalGroup = "a" | "o" | "e" | "i" | "u" | "ü";

export type FinalKind =
  "vowel" | "apical" | "rhotic" | "diphthong" | "triphthong" | "vowel-nasal" | "diphthong-nasal";

export type PinyinFinal = {
  /** As in the 1958 table, before the spelling rules; `-i` is the apical vowel of zhi… si. */
  readonly letters: string;
  readonly group: FinalGroup;
  readonly ipa: string;
  readonly kind: FinalKind;
  /** Initials it forms a syllable with, `-` for none. */
  readonly initials: string;
};

const initial = (
  letters: string,
  ipa: string,
  place: Place,
  manner: Manner,
  reading: string,
  chaoIpa: string | null = null,
): PinyinInitial => ({ letters, ipa, chaoIpa, place, manner, reading });

export const INITIALS: readonly PinyinInitial[] = [
  initial("b", "p", "bilabial", "plosive", "bo"),
  initial("p", "pʰ", "bilabial", "aspirated-plosive", "po"),
  initial("m", "m", "bilabial", "nasal", "mo"),
  initial("f", "f", "labiodental", "fricative", "fo"),
  initial("d", "t", "denti-alveolar", "plosive", "de"),
  initial("t", "tʰ", "denti-alveolar", "aspirated-plosive", "te"),
  initial("n", "n", "denti-alveolar", "nasal", "ne"),
  initial("l", "l", "denti-alveolar", "lateral", "le"),
  initial("g", "k", "velar", "plosive", "ge"),
  initial("k", "kʰ", "velar", "aspirated-plosive", "ke"),
  initial("h", "x", "velar", "fricative", "he"),
  initial("j", "tɕ", "alveolo-palatal", "affricate", "ji"),
  initial("q", "tɕʰ", "alveolo-palatal", "aspirated-affricate", "qi"),
  initial("x", "ɕ", "alveolo-palatal", "fricative", "xi"),
  initial("zh", "tʃ̺", "post-alveolar", "affricate", "zhi", "tʂ"),
  initial("ch", "tʃ̺ʰ", "post-alveolar", "aspirated-affricate", "chi", "tʂʰ"),
  initial("sh", "ʃ̺", "post-alveolar", "fricative", "shi", "ʂ"),
  initial("r", "ɹ̺", "post-alveolar", "approximant", "ri", "ɹ"),
  initial("z", "ts", "denti-alveolar", "affricate", "zi"),
  initial("c", "tsʰ", "denti-alveolar", "aspirated-affricate", "ci"),
  initial("s", "s", "denti-alveolar", "fricative", "si"),
];

const final = (
  letters: string,
  group: FinalGroup,
  ipa: string,
  kind: FinalKind,
  initials: string,
): PinyinFinal => ({ letters, group, ipa, kind, initials });

// o and ê are the vowels of uo and ie / üe (1958 table), which Lee & Zee note [o] and [e];
// ueng is their [uə] before [ŋ].
export const FINALS: readonly PinyinFinal[] = [
  final("a", "a", "a", "vowel", "- b p m f d t n l g k h zh ch sh z c s"),
  final("ai", "a", "ai", "diphthong", "- b p m d t n l g k h zh ch sh z c s"),
  final("ao", "a", "au", "diphthong", "- b p m d t n l g k h zh ch sh r z c s"),
  final("an", "a", "an", "vowel-nasal", "- b p m f d t n l g k h zh ch sh r z c s"),
  final("ang", "a", "aŋ", "vowel-nasal", "- b p m f d t n l g k h zh ch sh r z c s"),
  final("o", "o", "o", "vowel", "- b p m f l"),
  final("ou", "o", "ou", "diphthong", "- p m f d t n l g k h zh ch sh r z c s"),
  final("ong", "o", "uŋ", "vowel-nasal", "d t n l g k h zh ch r z c s"),
  final("e", "e", "ɤ", "vowel", "- m d t n l g k h zh ch sh r z c s"),
  final("ê", "e", "e", "vowel", "-"),
  final("ei", "e", "ei", "diphthong", "- b p m f d t n l g k h zh sh z s"),
  final("en", "e", "ən", "vowel-nasal", "- b p m f d n g k h zh ch sh r z c s"),
  final("eng", "e", "əŋ", "vowel-nasal", "- b p m f d t n l g k h zh ch sh r z c s"),
  final("er", "e", "ɚ", "rhotic", "-"),
  final("i", "i", "i", "vowel", "- b p m d t n l j q x"),
  final("-i", "i", "ɹ̩", "apical", "zh ch sh r z c s"),
  final("ia", "i", "ia", "diphthong", "- d l j q x"),
  final("ie", "i", "ie", "diphthong", "- b p m d t n l j q x"),
  final("iao", "i", "iau", "triphthong", "- b p m d t n l j q x"),
  final("iou", "i", "iou", "triphthong", "- m d n l j q x"),
  final("ian", "i", "ien", "diphthong-nasal", "- b p m d t n l j q x"),
  final("in", "i", "in", "vowel-nasal", "- b p m n l j q x"),
  final("iang", "i", "iaŋ", "diphthong-nasal", "- n l j q x"),
  final("ing", "i", "iŋ", "vowel-nasal", "- b p m d t n l j q x"),
  final("iong", "i", "iuŋ", "diphthong-nasal", "- j q x"),
  final("u", "u", "u", "vowel", "- b p m f d t n l g k h zh ch sh r z c s"),
  final("ua", "u", "ua", "diphthong", "- g k h zh ch sh r"),
  final("uo", "u", "uo", "diphthong", "- d t n l g k h zh ch sh r z c s"),
  final("uai", "u", "uai", "triphthong", "- g k h zh ch sh"),
  final("uei", "u", "uei", "triphthong", "- d t g k h zh ch sh r z c s"),
  final("uan", "u", "uan", "diphthong-nasal", "- d t n l g k h zh ch sh r z c s"),
  final("uen", "u", "uən", "diphthong-nasal", "- d t l g k h zh ch sh r z c s"),
  final("uang", "u", "uaŋ", "diphthong-nasal", "- g k h zh ch sh"),
  final("ueng", "u", "uəŋ", "diphthong-nasal", "-"),
  final("ü", "ü", "y", "vowel", "- n l j q x"),
  final("üe", "ü", "ye", "diphthong", "- n l j q x"),
  final("üan", "ü", "yen", "diphthong-nasal", "- j q x"),
  final("ün", "ü", "yn", "vowel-nasal", "- j q x"),
];

/** Syllables outside the initial × final grid: syllabic nasals and yo. */
export const INTERJECTIONS: readonly string[] = ["m", "hm", "hng", "yo"];

const CONTRACTED: Readonly<Record<string, string>> = { iou: "iu", uei: "ui", uen: "un" };

const zeroInitial = (letters: string): string => {
  if (["i", "in", "ing"].includes(letters)) return `y${letters}`;
  if (letters === "u") return "wu";
  if (letters.startsWith("ü")) return `yu${letters.slice(1)}`;
  if (letters.startsWith("i")) return `y${letters.slice(1)}`;
  if (letters.startsWith("u")) return `w${letters.slice(1)}`;
  return letters;
};

const withInitial = (initialLetters: string, letters: string): string => {
  if (letters === "-i") return `${initialLetters}i`;
  if (letters.startsWith("ü") && ["j", "q", "x"].includes(initialLetters)) {
    return `${initialLetters}u${letters.slice(1)}`;
  }
  return `${initialLetters}${CONTRACTED[letters] ?? letters}`;
};

/** Written syllable, or `null` when Standard Chinese has no such syllable. `null` initial = none. */
export const spell = (initialLetters: string | null, pinyinFinal: PinyinFinal): string | null => {
  if (!pinyinFinal.initials.split(" ").includes(initialLetters ?? "-")) return null;
  return initialLetters === null
    ? zeroInitial(pinyinFinal.letters)
    : withInitial(initialLetters, pinyinFinal.letters);
};
