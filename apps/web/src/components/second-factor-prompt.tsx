import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthFailure } from "@/components/auth-failure";
import { CodeField } from "@/components/code-field";
import { Button } from "@/components/ui/button";
import {
  BACKUP_CODE_LENGTH,
  signOut,
  TOTP_LENGTH,
  verifyBackupCode,
  verifyTotp,
} from "@/data/account";

/** Every new session of an account with TOTP on asks for it first (ADR 0015). */
export const SecondFactorPrompt = ({ onDone }: { readonly onDone: () => void }) => {
  const { t } = useTranslation();
  const describe = useAuthFailure();
  const [backup, setBackup] = useState(false);
  const [code, setCode] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    field.current?.focus();
  }, [backup]);
  useEffect(() => {
    if (problem !== null) alert.current?.focus();
  }, [problem]);

  const verify = async () => {
    if (busy) return;
    const typed = code.trim();
    if (typed === "") {
      setFieldError(backup ? t("auth.twoFactor.backupWrong") : t("auth.twoFactor.wrong"));
      field.current?.focus();
      return;
    }
    setBusy(true);
    const result = await (backup ? verifyBackupCode(typed) : verifyTotp(typed));
    setBusy(false);
    if (result.ok) {
      onDone();
      return;
    }
    const { error } = result;
    if (
      error.kind === "refused" &&
      (error.code === "INVALID_CODE" || error.code === "INVALID_BACKUP_CODE")
    ) {
      setFieldError(backup ? t("auth.twoFactor.backupWrong") : t("auth.twoFactor.wrong"));
      setProblem(null);
      field.current?.focus();
      return;
    }
    setProblem(describe(error));
  };

  const leave = async () => {
    const result = await signOut();
    if (result.ok) onDone();
    else setProblem(describe(result.error));
  };

  return (
    <form
      noValidate
      className="mt-6 flex flex-col items-start gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void verify();
      }}
    >
      <h2 className="text-subtitle">{t("auth.twoFactor.promptTitle")}</h2>
      <p>{t("auth.twoFactor.promptIntro")}</p>
      {problem !== null && (
        <p ref={alert} role="alert" tabIndex={-1} className="text-danger">
          {problem}
        </p>
      )}
      <CodeField
        key={String(backup)}
        inputRef={field}
        label={backup ? t("auth.twoFactor.backupCode") : t("auth.twoFactor.code")}
        value={code}
        numeric={!backup}
        maxLength={backup ? BACKUP_CODE_LENGTH : TOTP_LENGTH}
        error={fieldError}
        onChange={(value) => {
          setCode(value);
          setFieldError(null);
        }}
      />
      <Button type="submit" aria-disabled={busy}>
        {t("auth.twoFactor.verify")}
      </Button>
      <Button
        variant="ghost"
        onClick={() => {
          setBackup((before) => !before);
          setCode("");
          setFieldError(null);
        }}
      >
        {backup ? t("auth.twoFactor.useApp") : t("auth.twoFactor.useBackup")}
      </Button>
      <Button variant="outline" onClick={() => void leave()}>
        {t("auth.signOut")}
      </Button>
    </form>
  );
};
