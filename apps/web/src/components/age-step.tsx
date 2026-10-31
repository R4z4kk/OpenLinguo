import type { AgeDeclaration } from "@openlinguo/core/account";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthFailure } from "@/components/auth-failure";
import { declareAge } from "@/data/account";

const ANSWERS = [
  { answer: "15-or-over", label: "over", line: "overLine" },
  { answer: "under-15", label: "under", line: "underLine" },
] as const satisfies readonly {
  readonly answer: AgeDeclaration["answer"];
  readonly label: string;
  readonly line: string;
}[];

/** Right after the first sign-in, for every method (ADR 0015); « moins de 15 ans » deletes at once. */
export const AgeStep = ({ onDeclared }: { readonly onDeclared: () => void }) => {
  const { t } = useTranslation();
  const describe = useAuthFailure();
  const id = useId();
  const [deleted, setDeleted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, [deleted]);
  useEffect(() => {
    if (problem !== null) alert.current?.focus();
  }, [problem]);

  const answer = async (value: AgeDeclaration["answer"]) => {
    if (busy) return;
    setBusy(true);
    const result = await declareAge(value);
    setBusy(false);
    if (!result.ok) {
      setProblem(describe(result.error));
      return;
    }
    if (value === "under-15") setDeleted(true);
    else onDeclared();
  };

  if (deleted)
    return (
      <>
        <h2 ref={heading} tabIndex={-1} className="mt-6 text-subtitle">
          {t("auth.age.deletedTitle")}
        </h2>
        <p className="mt-2">{t("auth.age.deletedBody")}</p>
      </>
    );

  return (
    <>
      <h2 ref={heading} tabIndex={-1} className="mt-6 text-subtitle">
        {t("auth.age.title")}
      </h2>
      <p className="mt-2">{t("auth.age.why")}</p>
      {problem !== null && (
        <p ref={alert} role="alert" tabIndex={-1} className="mt-4 text-danger">
          {problem}
        </p>
      )}
      <ul className="mt-4 flex flex-col gap-3">
        {ANSWERS.map(({ answer: value, label, line }) => (
          <li key={value} className="flex flex-col gap-1">
            <button
              type="button"
              aria-describedby={`${id}-${value}`}
              aria-disabled={busy}
              onClick={() => void answer(value)}
              className="min-h-11 rounded-control border border-border-strong bg-surface px-4 text-left font-semibold hover:bg-sunken"
            >
              {t(`auth.age.${label}`)}
            </button>
            <p id={`${id}-${value}`} className="text-small text-muted">
              {t(`auth.age.${line}`)}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
};
