import { alignChars, type CharMatch } from "@openlinguo/lang-zh";
import { useTranslation } from "react-i18next";
import { Pinyin, type PinyinFeatures } from "@/components/pinyin";
import type { ReadChar } from "@/data/transcript";

const PINYIN = "zh-Latn-pinyin";

/** Speech recognition does not judge tones: what it heard is shown without them, the syllable that matches first. */
const heardSyllable = (heard: ReadChar, expected: ReadChar | null): string | null => {
  for (const syllable of expected?.syllables ?? [])
    if (heard.syllables.has(syllable)) return syllable;
  return heard.reading?.replace(/\d$/u, "").replace("u:", "ü") ?? [...heard.syllables][0] ?? null;
};

const Expected = ({
  char,
  features,
}: {
  readonly char: ReadChar;
  readonly features: PinyinFeatures;
}) => (
  <>
    <span lang="zh-Hans">{char.char}</span>
    {char.reading !== null && (
      <>
        {" "}
        <Pinyin reading={char.reading} features={features} className={null} />
      </>
    )}
  </>
);

const Heard = ({
  char,
  expected,
}: {
  readonly char: ReadChar;
  readonly expected: ReadChar | null;
}) => {
  const syllable = heardSyllable(char, expected);
  return (
    <>
      <span lang="zh-Hans">{char.char}</span>
      {syllable !== null && (
        <>
          {" "}
          (<span lang={PINYIN}>{syllable}</span>)
        </>
      )}
    </>
  );
};

/**
 * What speech recognition heard against the expected text, as text: the transcript, how many
 * characters were heard as expected (the same character or a homophone), then each difference.
 */
export const HeardText = ({
  expected,
  heard,
  features,
}: {
  readonly expected: readonly ReadChar[];
  readonly heard: readonly ReadChar[];
  readonly features: PinyinFeatures;
}) => {
  const { t } = useTranslation();
  const matches = alignChars(expected, heard);
  const right = matches.filter(({ kind }) => kind === "same" || kind === "homophone").length;
  const differences = matches.filter(({ kind }) => kind !== "same");
  const item = (match: CharMatch<ReadChar>) => {
    switch (match.kind) {
      case "same":
        return null;
      case "homophone":
      case "different":
        return (
          <>
            <Expected char={match.expected} features={features} />
            {": "}
            {t("hear.heardAs")} <Heard char={match.heard} expected={match.expected} />
            {match.kind === "homophone" && t("hear.sameSyllable")}
          </>
        );
      case "missing":
        return (
          <>
            <Expected char={match.expected} features={features} />
            {": "}
            {t("hear.missing")}
          </>
        );
      case "extra":
        return (
          <>
            {t("hear.extra")} <Heard char={match.heard} expected={null} />
          </>
        );
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <p>
        {t("hear.heard")}{" "}
        {heard.length === 0 ? (
          t("hear.nothing")
        ) : (
          <span lang="zh-Hans">{heard.map(({ char }) => char).join("")}</span>
        )}
      </p>
      <p>
        {differences.length === 0
          ? t("hear.allRight")
          : t("hear.summary", { right, total: expected.length })}
      </p>
      {differences.length > 0 && (
        <ul className="flex flex-col gap-1">
          {differences.map((match, index) => (
            // The list is rebuilt for each transcript: the index is a stable key.
            <li key={index}>{item(match)}</li>
          ))}
        </ul>
      )}
    </div>
  );
};
