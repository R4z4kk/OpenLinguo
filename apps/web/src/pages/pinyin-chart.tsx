import {
  FINALS,
  INITIALS,
  INTERJECTIONS,
  spell,
  type FinalGroup,
  type PinyinFinal,
  type PinyinInitial,
} from "@openlinguo/lang-zh";
import { useId } from "react";
import { useTranslation } from "react-i18next";

const GROUPS: readonly FinalGroup[] = ["a", "o", "e", "i", "u", "ü"];
const RULES = ["yw", "umlaut", "contracted", "apical"] as const;
const COLUMNS: readonly (PinyinInitial | null)[] = [null, ...INITIALS];

const SCHEME = "https://zh.wikisource.org/wiki/汉语拼音方案";
const LEE_ZEE = "https://doi.org/10.1017/S0025100303001208";

const finalsOf = (group: FinalGroup): readonly PinyinFinal[] =>
  FINALS.filter((pinyinFinal) => pinyinFinal.group === group);

const Ipa = ({ ipa }: { readonly ipa: string }) => <span className="font-ipa">[{ipa}]</span>;

const PinyinText = ({ text }: { readonly text: string }) => (
  <span lang="zh-Latn-pinyin" className="font-zh">
    {text}
  </span>
);

const Initials = () => {
  const { t } = useTranslation();
  const id = useId();
  return (
    <section aria-labelledby={id} className="mt-10 max-w-3xl">
      <h2 id={id} className="text-subtitle">
        {t("pinyinChart.initials")}
      </h2>
      <p className="mt-2 text-muted">{t("pinyinChart.initialsIntro")}</p>
      <table className="mt-4 w-full text-left">
        <thead>
          <tr>
            {(["initial", "saidAlone", "ipa", "place", "manner"] as const).map((column) => (
              <th key={column} scope="col" className="border-b border-hairline py-2 pe-3">
                {t(`pinyinChart.${column}`)}
              </th>
            ))}
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
              <td className="py-2">{t(`pinyinChart.manners.${manner}`)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
};

const Finals = () => {
  const { t } = useTranslation();
  const id = useId();
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
              </tr>
            </thead>
            <tbody>
              {finalsOf(group).map(({ letters, ipa, kind }) => (
                <tr key={letters} className="border-b border-hairline">
                  <th scope="row" className="py-1 pe-3">
                    <PinyinText text={letters} />
                  </th>
                  <td className="py-1 pe-3">
                    <Ipa ipa={ipa} />
                  </td>
                  <td className="py-1">{t(`pinyinChart.kinds.${kind}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
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

const SyllableGrid = () => {
  const { t } = useTranslation();
  const id = useId();
  return (
    <section className="mt-10">
      <h2 id={id} className="text-subtitle">
        {t("pinyinChart.syllables")}
      </h2>
      <p className="mt-2 max-w-3xl text-muted">{t("pinyinChart.syllablesIntro")}</p>
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
                    return (
                      <td
                        key={initial?.letters ?? "-"}
                        className="border-r border-b border-hairline px-2 py-1"
                      >
                        {written !== null && <PinyinText text={written} />}
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
  return (
    <section aria-labelledby="pinyin-chart-title">
      <h1 id="pinyin-chart-title" className="text-title">
        {t("pinyinChart.title")}
      </h1>
      <p className="mt-2 max-w-3xl text-muted">{t("pinyinChart.intro")}</p>
      <Initials />
      <Finals />
      <SpellingRules />
      <SyllableGrid />
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
