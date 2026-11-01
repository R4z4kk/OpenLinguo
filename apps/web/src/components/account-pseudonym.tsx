import { Pseudonym, PSEUDONYM_MAX } from "@openlinguo/core/submission";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthFailure } from "@/components/auth-failure";
import { Button } from "@/components/ui/button";
import { savePseudonym, type Session } from "@/data/account";
import { fieldClass } from "@/shell/ai-settings";

/** Profile › Compte › « Pseudonyme »: set when a text is first signed, then rectified here. */
export const AccountPseudonym = ({
  session,
  onSaved,
}: {
  readonly session: Session;
  readonly onSaved: () => void;
}) => {
  const { t } = useTranslation("auth");
  const describe = useAuthFailure();
  const id = useId();
  const [name, setName] = useState(session.user.name);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  const save = async () => {
    if (busy) return;
    const parsed = Pseudonym.safeParse(name);
    if (!parsed.success) {
      setFieldError(t("pseudonym.invalid", { max: PSEUDONYM_MAX }));
      field.current?.focus();
      return;
    }
    setBusy(true);
    const result = await savePseudonym(parsed.data);
    setBusy(false);
    if (!result.ok) {
      setProblem(describe(result.error));
      return;
    }
    setProblem(null);
    setStatus(t("pseudonym.saved"));
    onSaved();
  };

  return (
    <section aria-labelledby={`${id}-title`} className="mt-8">
      <h2 id={`${id}-title`} className="text-subtitle">
        {t("pseudonym.title")}
      </h2>
      {session.user.name === "" ? (
        <p className="mt-2">{t("pseudonym.none")}</p>
      ) : (
        <form
          noValidate
          className="mt-2 flex flex-col items-start gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label htmlFor={`${id}-field`} className="font-semibold">
            {t("pseudonym.field")}
          </label>
          <p id={`${id}-help`} className="text-small text-muted">
            {t("pseudonym.help", { max: PSEUDONYM_MAX })} {t("pseudonym.identity")}{" "}
            {t("pseudonym.kept")}
          </p>
          <input
            ref={field}
            id={`${id}-field`}
            value={name}
            maxLength={PSEUDONYM_MAX}
            autoComplete="nickname"
            aria-invalid={fieldError !== null}
            aria-describedby={`${id}-help${fieldError === null ? "" : ` ${id}-error`}`}
            onChange={(event) => {
              setName(event.currentTarget.value);
              setFieldError(null);
              setStatus("");
            }}
            className={`${fieldClass} max-w-sm`}
          />
          {fieldError !== null && (
            <p id={`${id}-error`} className="text-small text-danger">
              {fieldError}
            </p>
          )}
          {problem !== null && (
            <p role="alert" className="text-danger">
              {problem}
            </p>
          )}
          <Button type="submit" variant="outline" aria-disabled={busy}>
            {t("pseudonym.save")}
          </Button>
          <p role="status" className="text-small">
            {status}
          </p>
        </form>
      )}
    </section>
  );
};
