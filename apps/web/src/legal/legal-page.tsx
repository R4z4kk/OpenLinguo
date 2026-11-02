import { CONTACT_EMAIL } from "@openlinguo/core/compliance-facts";
import { Link, useSearch } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { languages, type Language } from "@/i18n/language";

export type LegalSection = {
  readonly id: string;
  readonly heading: string;
  readonly body: ReactNode;
};

export type LegalDocument = {
  readonly title: string;
  /** ISO date of the last change to the text. */
  readonly updated: string;
  readonly sections: readonly LegalSection[];
};

export type LegalPath = "/legal" | "/privacy" | "/terms";

export type LegalSearch = { readonly lang: Language | null };

/** `?lang=` picks the version; the page otherwise follows the interface language. */
export const validateLegalSearch = (search: Record<string, unknown>): LegalSearch => ({
  lang: languages.find((language) => language === search["lang"]) ?? null,
});

export const Paragraph = ({ children }: { readonly children: ReactNode }) => (
  <p className="mt-3">{children}</p>
);

export const List = ({ items }: { readonly items: readonly ReactNode[] }) => (
  <ul className="mt-3 list-disc space-y-1 ps-6">
    {items.map((item, index) => (
      <li key={index}>{item}</li>
    ))}
  </ul>
);

export const External = ({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) => (
  <a href={href} className="underline">
    {children}
  </a>
);

export const Contact = () => (
  <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
    {CONTACT_EMAIL}
  </a>
);

export const Table = ({
  caption,
  head,
  rows,
}: {
  readonly caption: string;
  readonly head: readonly string[];
  readonly rows: readonly (readonly ReactNode[])[];
}) => (
  <div className="mt-3 overflow-x-auto">
    <table className="w-full text-left text-small">
      <caption className="text-left font-semibold">{caption}</caption>
      <thead>
        <tr>
          {head.map((cell) => (
            <th key={cell} scope="col" className="border-b border-hairline py-2 pe-4">
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index} className="border-b border-hairline">
            {row.map((cell, column) => (
              <td key={column} className="py-2 pe-4 align-top">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/** The template of `/legal`, `/privacy` and `/terms` (#267 mockups). */
export const LegalPage = ({
  path,
  versions,
  contents,
}: {
  readonly path: LegalPath;
  readonly versions: Readonly<Record<Language, LegalDocument>>;
  readonly contents: boolean;
}) => {
  const { t, i18n } = useTranslation("legal");
  const search = validateLegalSearch(useSearch({ strict: false }));
  const language =
    search.lang ?? languages.find((candidate) => candidate === i18n.language) ?? "fr";
  const other = languages.find((candidate) => candidate !== language) ?? "en";
  const document = versions[language];
  const updated = new Intl.DateTimeFormat(language, { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(document.updated),
  );
  return (
    <section className="max-w-[960px]">
      <Link to="/profile/about" className="-mt-3 mb-1 flex min-h-11 w-fit items-center gap-1">
        <ChevronLeft aria-hidden="true" className="size-5" />
        {t("back")}
      </Link>
      <article lang={language}>
        <h1 className="text-title">{document.title}</h1>
        <p className="mt-2 text-small text-muted">
          {t("updated", { date: updated, lng: language })}
        </p>
        <p className="mt-1 text-small">
          <Link
            to={path}
            search={{ lang: other }}
            lang={other}
            hrefLang={other}
            className="inline-flex min-h-6 items-center underline"
          >
            {t("otherVersion", { lng: other })}
          </Link>
          {language === "en" && (
            <span className="ms-2 text-muted">{t("prevails", { lng: "en" })}</span>
          )}
        </p>
        <div className={contents ? "mt-6 lg:grid lg:grid-cols-[240px_1fr] lg:gap-8" : "mt-6"}>
          {contents && (
            <nav aria-labelledby="legal-contents" className="mb-6 lg:mb-0">
              <h2 id="legal-contents" className="font-semibold">
                {t("contents", { lng: language })}
              </h2>
              <ol className="mt-2 list-decimal space-y-1 ps-6 text-small">
                {document.sections.map((section) => (
                  <li key={section.id}>
                    <a href={`#${section.id}`} className="underline">
                      {section.heading}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          )}
          <div className="max-w-2xl">
            {document.sections.map((section, index) => (
              <section key={section.id} aria-labelledby={section.id} className="mt-8 first:mt-0">
                <h2 id={section.id} className="text-subtitle">
                  {contents ? `${String(index + 1)}. ${section.heading}` : section.heading}
                </h2>
                {section.body}
              </section>
            ))}
          </div>
        </div>
      </article>
    </section>
  );
};

const LINKS = [
  ["/legal", "notice"],
  ["/privacy", "privacy"],
  ["/terms", "terms"],
] as const satisfies readonly (readonly [LegalPath, string])[];

/** The three legal pages, linked from « À propos » and the sign-in screen. */
export const LegalLinks = () => {
  const { t } = useTranslation("legal");
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4">
      {LINKS.map(([to, label]) => (
        <li key={to}>
          <Link to={to} className="inline-flex min-h-11 items-center underline">
            {t(label)}
          </Link>
        </li>
      ))}
    </ul>
  );
};
