import type { Gloss } from "@openlinguo/core";
import { useTranslation } from "react-i18next";
import { summarizeGlosses } from "@/data/gloss-summary";
import { languages, type Language } from "@/i18n/language";
import { cn } from "@/lib/utils";

type Props = {
  readonly glosses: readonly Gloss[];
  readonly language: Language;
  readonly className: string | null;
};

/** Glosses in the interface language, else in the other one with its name shown. */
export const GlossSummary = ({ glosses, language, className }: Props) => {
  const { t } = useTranslation();
  const summary = summarizeGlosses(glosses, [
    language,
    ...languages.filter((lang) => lang !== language),
  ]);
  if (summary === null) return null;
  return (
    <p className={cn("line-clamp-2", className)}>
      {summary.lang !== language && (
        <>
          <span className="rounded-full border border-border-strong px-2 text-caption text-muted">
            {t(`dictionary.glossesIn.${summary.lang}`)}
          </span>{" "}
        </>
      )}
      <span lang={summary.lang}>
        {summary.texts.join(summary.lang === "fr" ? "\u00a0; " : "; ")}
      </span>
    </p>
  );
};
