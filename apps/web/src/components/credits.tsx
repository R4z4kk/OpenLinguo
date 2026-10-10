import { useId } from "react";
import { useTranslation } from "react-i18next";

type Credit = {
  readonly name: string;
  readonly url: string;
  readonly holder: string;
  /** Shown as a link after the holder, when the license asks for it. */
  readonly site: string | null;
  readonly license: string;
  readonly licenseUrl: string;
};

const CC_BY_SA_4 = "https://creativecommons.org/licenses/by-sa/4.0/";

/** Attribution of every shipped dataset (data/SOURCES.md). License texts ship in /data/licenses/. */
export const CREDITS = {
  "cc-cedict": {
    name: "CC-CEDICT",
    url: "https://www.mdbg.net/chinese/dictionary?page=cc-cedict",
    holder: "MDBG",
    site: null,
    license: "CC BY-SA 4.0",
    licenseUrl: CC_BY_SA_4,
  },
  cfdict: {
    name: "CFDICT",
    url: "https://chine.in/chinois/open/CFDICT/",
    holder: "Chine Informations",
    site: "https://chine.in",
    license: "CC BY-SA 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
  },
  "wiktionary-fr": {
    name: "Wiktionnaire",
    url: "https://kaikki.org/frwiktionary/Chinois/index.html",
    holder: "Wiktionary contributors, Wiktextract (Tatu Ylonen), kaikki.org",
    site: null,
    license: "CC BY-SA 4.0",
    licenseUrl: CC_BY_SA_4,
  },
  "hsk-2025": {
    name: "HSK 2025",
    url: "https://www.chinesetest.cn",
    holder:
      "Center for Language Education and Cooperation, Chinese Testing International; transcription harukicoder/hsk30",
    site: null,
    license: "MIT",
    licenseUrl: "https://github.com/harukicoder/hsk30",
  },
  "gf0025-2021": {
    name: "GF0025-2021",
    url: "http://www.moe.gov.cn/jyb_xwfb/gzdt_gzdt/s5987/202103/t20210329_523304.html",
    holder:
      "Ministry of Education and State Language Commission of the PRC; OCR Pleco Inc. via elkmovie/hsk30",
    site: null,
    license: "MIT",
    licenseUrl: "https://github.com/elkmovie/hsk30",
  },
  wordfreq: {
    name: "wordfreq",
    url: "https://github.com/rspeer/wordfreq",
    holder: "Robyn Speer",
    site: null,
    license: "CC BY-SA 4.0",
    licenseUrl: CC_BY_SA_4,
  },
  makemeahanzi: {
    name: "Make Me a Hanzi",
    url: "https://github.com/skishore/makemeahanzi",
    holder: "Shaunak Kishore, with Unihan data © Unicode, Inc.",
    site: null,
    license: "LGPL-3.0",
    licenseUrl: "/data/licenses/makemeahanzi/LGPL.txt",
  },
  "hanzi-writer-data": {
    name: "hanzi-writer-data",
    url: "https://github.com/chanind/hanzi-writer-data",
    holder: "David Chanin, from Make Me a Hanzi, © Arphic Technology",
    site: null,
    license: "Arphic Public License",
    licenseUrl: "/data/licenses/hanzi-writer-data/ARPHICPL.txt",
  },
  fonts: {
    name: "Atkinson Hyperlegible Next, Noto Sans SC, LXGW WenKai GB",
    url: "https://openfontlicense.org",
    holder: "Braille Institute; Adobe, Google; LXGW, from Klee One by Fontworks",
    site: null,
    license: "SIL Open Font License 1.1",
    licenseUrl: "https://openfontlicense.org/open-font-license-official-text/",
  },
} as const satisfies Readonly<Record<string, Credit>>;

export type CreditId = keyof typeof CREDITS;

export const CreditList = ({ ids }: { readonly ids: readonly CreditId[] }) => {
  const { t } = useTranslation();
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {ids.map((id) => {
        const credit: Credit = CREDITS[id];
        return (
          <li key={id}>
            {t(`credits.${id}`)}{" "}
            <a href={credit.url} className="underline">
              {credit.name}
            </a>{" "}
            ({credit.holder},{" "}
            {credit.site !== null && (
              <>
                <a href={credit.site} className="underline">
                  {credit.site}
                </a>
                ,{" "}
              </>
            )}
            <a href={credit.licenseUrl} className="underline">
              {credit.license}
            </a>
            )
          </li>
        );
      })}
    </ul>
  );
};

/** Sources of what a page shows, under its content. */
export const Credits = ({ ids }: { readonly ids: readonly CreditId[] }) => {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <footer
      aria-labelledby={titleId}
      className="mt-12 border-t border-hairline pt-4 text-small text-muted"
    >
      <h2 id={titleId} className="font-semibold">
        {t("credits.title")}
      </h2>
      <CreditList ids={ids} />
    </footer>
  );
};
