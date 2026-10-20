import {
  FINALS,
  INITIALS,
  INTERJECTIONS,
  readingKey,
  spell,
  type FinalGroup,
  type PinyinFinal,
  type PinyinInitial,
} from "@openlinguo/lang-zh";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { SegmentedControl, type SegmentedOption } from "@/components/segmented-control";
import {
  spoken,
  SyllableSound,
  useSyllableAudio,
  useSyllablePlayer,
} from "@/components/syllable-sound";

const GROUPS: readonly FinalGroup[] = ["a", "o", "e", "i", "u", "ü"];
const RULES = ["yw", "umlaut", "contracted", "apical"] as const;
const COLUMNS: readonly (PinyinInitial | null)[] = [null, ...INITIALS];

const SCHEME = "https://zh.wikisource.org/wiki/汉语拼音方案";
const LEE_ZEE = "https://doi.org/10.1017/S0025100303001208";

const TONES = [1, 2, 3, 4] as const;
type ToneChoice = (typeof TONES)[number] | "all";

/** Reading keys of a written syllable in these tones: `lu:4` for lü. */
const keysOf = (written: string, tones: readonly number[]): string[] =>
  tones.flatMap((tone) => {
    const key = readingKey(`${written}${String(tone)}`);
    return key.ok ? [key.value] : [];
  });

const SYLLABLE_BUTTON =
  "inline-flex min-h-6 min-w-6 items-center justify-center rounded-control px-1 hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink";

type Recordings = ReadonlyMap<string, string>;

const finalsOf = (group: FinalGroup): readonly PinyinFinal[] =>
  FINALS.filter((pinyinFinal) => pinyinFinal.group === group);

const Ipa = ({ ipa }: { readonly ipa: string }) => <span className="font-ipa">[{ipa}]</span>;

const PinyinText = ({ text }: { readonly text: string }) => (
  <span lang="zh-Latn-pinyin" className="font-zh">
    {text}
  </span>
);

/** A sound said alone plays `written` in tone 1, else in the first tone recorded; none: no button. */
const SaidAlone = ({
  written,
  recordings,
  play,
}: {
  readonly written: string | null;
  readonly recordings: Recordings;
  readonly play: (keys: readonly string[]) => Promise<void>;
}) => {
  const key =
    written === null ? null : (keysOf(written, TONES).find((tone) => recordings.has(tone)) ?? null);
  return (
    key !== null && (
      <button type="button" className={SYLLABLE_BUTTON} onClick={() => void play([key])}>
        <PinyinText text={spoken(key)} />
      </button>
    )
  );
};

const Initials = ({ recordings }: { readonly recordings: Recordings | null }) => {
  const { t } = useTranslation();
  const id = useId();
  const { play, notice } = useSyllablePlayer(recordings ?? new Map());
  const columns = ["initial", "saidAlone", "ipa", "place", "manner"] as const;
  return (
    <section aria-labelledby={id} className="mt-10 max-w-3xl">
      <h2 id={id} className="text-subtitle">
        {t("pinyinChart.initials")}
      </h2>
      <p className="mt-2 text-muted">{t("pinyinChart.initialsIntro")}</p>
      <table className="mt-4 w-full text-left">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className="border-b border-hairline py-2 pe-3">
                {t(`pinyinChart.${column}`)}
              </th>
            ))}
            {recordings !== null && (
              <th scope="col" className="border-b border-hairline py-2">
                {t("pinyinChart.hear")}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {INITIALS.map(({ letters, reading, ipa, chaoIpa, place, manner }) => (
            <tr key={letters} className="border-b border-hairline align-top">
              <th scope="row" className="py-2 pe-3 text-pinyin">
                <PinyinText text={letters} />
              </th>
              <td className="py-2 pe-3">
                <PinyinText text={reading} />
              </td>
              <td className="py-2 pe-3">
                <Ipa ipa={ipa} />
                {chaoIpa !== null && (
                  <span className="block text-small text-muted">
                    {t("pinyinChart.chao")} <Ipa ipa={chaoIpa} />
                  </span>
                )}
              </td>
              <td className="py-2 pe-3">{t(`pinyinChart.places.${place}`)}</td>
              <td className="py-2 pe-3">{t(`pinyinChart.manners.${manner}`)}</td>
              {recordings !== null && (
                <td className="py-2">
                  <SaidAlone written={reading} recordings={recordings} play={play} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {recordings !== null && (
        <p role="status" className={notice?.failed === true ? "mt-3 text-danger" : "mt-3"}>
          {notice?.text}
        </p>
      )}
    </section>
  );
};

/** A final said alone plays its zero-initial spelling: yi, wu, yu, ya… */
const Finals = ({ recordings }: { readonly recordings: Recordings | null }) => {
  const { t } = useTranslation();
  const id = useId();
  const { play, notice } = useSyllablePlayer(recordings ?? new Map());
  return (
    <section aria-labelledby={id} className="mt-10 max-w-5xl">
      <h2 id={id} className="text-subtitle">
        {t("pinyinChart.finals")}
      </h2>
      <p className="mt-2 text-muted">{t("pinyinChart.finalsIntro")}</p>
      <div className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {GROUPS.map((group) => (
          <table key={group} className="w-full self-start text-left">
            <caption className="pb-1 text-left font-semibold">
              {t("pinyinChart.group", { letter: group })}
            </caption>
            <thead>
              <tr>
                {(["final", "ipa", "kind"] as const).map((column) => (
                  <th key={column} scope="col" className="border-b border-hairline py-1 pe-3">
                    {t(`pinyinChart.${column}`)}
                  </th>
                ))}
                {recordings !== null && (
                  <th scope="col" className="border-b border-hairline py-1">
                    {t("pinyinChart.hear")}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {finalsOf(group).map((pinyinFinal) => (
                <tr key={pinyinFinal.letters} className="border-b border-hairline">
                  <th scope="row" className="py-1 pe-3">
                    <PinyinText text={pinyinFinal.letters} />
                  </th>
                  <td className="py-1 pe-3">
                    <Ipa ipa={pinyinFinal.ipa} />
                  </td>
                  <td className="py-1 pe-3">{t(`pinyinChart.kinds.${pinyinFinal.kind}`)}</td>
                  {recordings !== null && (
                    <td className="py-1">
                      <SaidAlone
                        written={spell(null, pinyinFinal)}
                        recordings={recordings}
                        play={play}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
      {recordings !== null && (
        <p role="status" className={notice?.failed === true ? "mt-3 text-danger" : "mt-3"}>
          {notice?.text}
        </p>
      )}
    </section>
  );
};

const SpellingRules = () => {
  const { t } = useTranslation();
  const id = useId();
  return (
    <section aria-labelledby={id} className="mt-10 max-w-3xl">
      <h2 id={id} className="text-subtitle">
        {t("pinyinChart.rules")}
      </h2>
      <p className="mt-2 text-muted">{t("pinyinChart.rulesIntro")}</p>
      <ol className="mt-4 grid list-decimal gap-2 ps-6">
        {RULES.map((rule) => (
          <li key={rule}>{t(`pinyinChart.rule.${rule}`)}</li>
        ))}
      </ol>
    </section>
  );
};

const STICKY_HEADER = "sticky z-10 bg-surface border-b border-r border-hairline px-2 py-1";

const SyllableGrid = ({ recordings }: { readonly recordings: Recordings | null }) => {
  const { t } = useTranslation();
  const id = useId();
  const hintId = useId();
  const [choice, setChoice] = useState<ToneChoice>(1);
  const { play, notice } = useSyllablePlayer(recordings ?? new Map());
  const tones = choice === "all" ? TONES : [choice];
  const options: readonly SegmentedOption<ToneChoice>[] = [
    ...["ā", "á", "ǎ", "à"].map((mark, index) => ({
      value: TONES[index] ?? 1,
      label: `${mark} ${String(index + 1)}`,
      lang: null,
    })),
    { value: "all", label: t("pinyinChart.toneAll"), lang: null },
  ];
  return (
    <section className="mt-10">
      <h2 id={id} className="text-subtitle">
        {t("pinyinChart.syllables")}
      </h2>
      <p className="mt-2 max-w-3xl text-muted">{t("pinyinChart.syllablesIntro")}</p>
      {recordings !== null && (
        <div className="mt-4">
          <SegmentedControl
            legend={t("pinyinChart.tone")}
            name="tone"
            options={options}
            value={choice}
            onChange={setChoice}
            failure={null}
          />
          <p id={hintId} className="mt-2 text-small text-muted">
            {choice === "all"
              ? t("pinyinChart.toneHintAll")
              : t("pinyinChart.toneHint", { tone: choice })}
          </p>
          <p
            role="status"
            className={notice?.failed === true ? "mt-2 min-h-6 text-danger" : "mt-2 min-h-6"}
          >
            {notice?.text}
          </p>
        </div>
      )}
      <div
        role="region"
        aria-labelledby={id}
        // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex -- Keyboard users scroll the grid once it has focus (axe scrollable-region-focusable).
        tabIndex={0}
        className="mt-4 max-h-[75vh] overflow-auto rounded-card border border-hairline"
      >
        <table className="border-separate border-spacing-0 text-center">
          <thead>
            <tr>
              <th scope="col" className={`${STICKY_HEADER} top-0 left-0 z-20 text-small`}>
                {t("pinyinChart.corner")}
              </th>
              {COLUMNS.map((initial) => (
                <th key={initial?.letters ?? "-"} scope="col" className={`${STICKY_HEADER} top-0`}>
                  {initial === null ? (
                    <>
                      <span aria-hidden="true">∅</span>
                      <span className="sr-only">{t("pinyinChart.noInitial")}</span>
                    </>
                  ) : (
                    <>
                      <PinyinText text={initial.letters} />
                      <span className="block text-caption font-normal text-muted">
                        <Ipa ipa={initial.ipa} />
                      </span>
                    </>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          {GROUPS.map((group) => (
            <tbody key={group} className="[&>tr:last-child>*]:border-b-border-strong">
              {finalsOf(group).map((pinyinFinal) => (
                <tr key={pinyinFinal.letters}>
                  <th scope="row" className={`${STICKY_HEADER} left-0 text-left whitespace-nowrap`}>
                    <PinyinText text={pinyinFinal.letters} />{" "}
                    <span className="text-caption font-normal text-muted">
                      <Ipa ipa={pinyinFinal.ipa} />
                    </span>
                  </th>
                  {COLUMNS.map((initial) => {
                    const written = spell(initial?.letters ?? null, pinyinFinal);
                    const keys = written === null ? [] : keysOf(written, tones);
                    const heard = keys.some((key) => recordings?.has(key) === true);
                    return (
                      <td
                        key={initial?.letters ?? "-"}
                        className="border-r border-b border-hairline px-2 py-1"
                      >
                        {written !== null &&
                          (recordings === null ? (
                            <PinyinText text={written} />
                          ) : (
                            <button
                              type="button"
                              aria-describedby={hintId}
                              className={`${SYLLABLE_BUTTON}${heard ? "" : " text-muted"}`}
                              onClick={() => void play(keys)}
                            >
                              <PinyinText text={written} />
                            </button>
                          ))}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      <p className="mt-3">{t("pinyinChart.interjections", { list: INTERJECTIONS.join(", ") })}</p>
    </section>
  );
};

export const PinyinChartPage = () => {
  const { t } = useTranslation();
  const { audio, refresh } = useSyllableAudio();
  const recordings =
    audio?.recordings.ok === true && audio.recordings.value.size > 0
      ? audio.recordings.value
      : null;
  return (
    <section aria-labelledby="pinyin-chart-title">
      <h1 id="pinyin-chart-title" className="text-title">
        {t("pinyinChart.title")}
      </h1>
      <p className="mt-2 max-w-3xl text-muted">{t("pinyinChart.intro")}</p>
      <SyllableSound audio={audio} refresh={refresh} />
      <SyllableGrid recordings={recordings} />
      <Initials recordings={recordings} />
      <Finals recordings={recordings} />
      <SpellingRules />
      <h2 className="mt-10 text-subtitle">{t("pinyinChart.sources")}</h2>
      <ul className="mt-2 grid max-w-3xl gap-1 text-small">
        <li>
          <a href={SCHEME} className="underline">
            <span lang="zh-Hans">汉语拼音方案</span>, {t("pinyinChart.scheme")}
          </a>
        </li>
        <li>
          <a href={LEE_ZEE} className="underline">
            {t("pinyinChart.leeZee")}
          </a>
        </li>
      </ul>
    </section>
  );
};
