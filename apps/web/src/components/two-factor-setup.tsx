import type { TotpSetup } from "@openlinguo/core/account";
import { correction, generate } from "lean-qr";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthFailure } from "@/components/auth-failure";
import { CodeField } from "@/components/code-field";
import { Button } from "@/components/ui/button";
import { backupCodesFile, enableTotp, keyOf, TOTP_LENGTH, verifyTotp } from "@/data/account";

const QUIET_ZONE = 4;

/** The dark modules as one SVG path, or `null` if the URI does not fit a QR code. */
const qrPath = (text: string): { readonly size: number; readonly d: string } | null => {
  try {
    const code = generate(text, { minCorrectionLevel: correction.M });
    const parts: string[] = [];
    for (let y = 0; y < code.size; y += 1)
      for (let x = 0; x < code.size; x += 1)
        if (code.get(x, y))
          parts.push(`M${String(x + QUIET_ZONE)} ${String(y + QUIET_ZONE)}h1v1h-1z`);
    return { size: code.size + QUIET_ZONE * 2, d: parts.join("") };
  } catch (error) {
    console.error("QR code not drawn", error);
    return null;
  }
};

/** White with a 1 px border in both themes, so every authenticator app can read it. */
const QrCode = ({ uri, label }: { readonly uri: string; readonly label: string }) => {
  const qr = useMemo(() => qrPath(uri), [uri]);
  if (qr === null) return null;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${String(qr.size)} ${String(qr.size)}`}
      shapeRendering="crispEdges"
      className="size-48 border border-[#000000] bg-[#ffffff]"
    >
      <path d={qr.d} fill="#000000" />
    </svg>
  );
};

const copy = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

const download = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
};

type Stage =
  | { readonly kind: "idle" }
  | { readonly kind: "scan"; readonly setup: TotpSetup }
  | { readonly kind: "codes"; readonly setup: TotpSetup };

/** Three numbered steps, then the backup codes shown once (mockups of #267). */
export const TwoFactorSetup = ({ onEnabled }: { readonly onEnabled: () => void }) => {
  const { t } = useTranslation("auth");
  const describe = useAuthFailure();
  const id = useId();
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [code, setCode] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [stored, setStored] = useState(false);
  const [storeError, setStoreError] = useState(false);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLParagraphElement>(null);
  const codesHeading = useRef<HTMLHeadingElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (stage.kind === "scan") first.current?.focus();
    if (stage.kind === "codes") codesHeading.current?.focus();
  }, [stage.kind]);
  useEffect(() => {
    if (problem !== null) alert.current?.focus();
  }, [problem]);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    const result = await enableTotp();
    setBusy(false);
    if (result.ok) {
      setProblem(null);
      setStage({ kind: "scan", setup: result.value });
    } else setProblem(describe(result.error));
  };

  const check = async (setup: TotpSetup) => {
    if (busy) return;
    const typed = code.replace(/\s/gu, "");
    if (typed.length !== TOTP_LENGTH) {
      setFieldError(t("twoFactor.wrong"));
      return;
    }
    setBusy(true);
    const result = await verifyTotp(typed);
    setBusy(false);
    if (result.ok) {
      setProblem(null);
      setStatus("");
      setStage({ kind: "codes", setup });
      return;
    }
    if (result.error.kind === "refused" && result.error.code === "INVALID_CODE")
      setFieldError(t("twoFactor.wrong"));
    else setProblem(describe(result.error));
  };

  const failure =
    problem === null ? null : (
      <p ref={alert} role="alert" tabIndex={-1} className="text-danger">
        {problem}
      </p>
    );
  const said = (
    <p role="status" className="text-small">
      {status}
    </p>
  );

  if (stage.kind === "idle")
    return (
      <div className="mt-2 flex flex-col items-start gap-2">
        {failure}
        <Button variant="outline" aria-disabled={busy} onClick={() => void start()}>
          {t("twoFactor.enable")}
        </Button>
      </div>
    );

  const { setup } = stage;
  if (stage.kind === "codes") {
    const text = backupCodesFile(setup.backupCodes, t("twoFactor.backupFile"));
    return (
      <div className="mt-4 flex flex-col items-start gap-3">
        <h3 ref={codesHeading} tabIndex={-1} className="font-semibold">
          {t("twoFactor.backupTitle")}
        </h3>
        <p>{t("twoFactor.backupIntro")}</p>
        <ul className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono">
          {setup.backupCodes.map((backup) => (
            <li key={backup}>{backup}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              download("openlinguo-backup-codes.txt", text);
            }}
          >
            {t("twoFactor.download")}
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              void copy(text).then((done) => {
                setStatus(done ? t("twoFactor.codesCopied") : t("twoFactor.copyFailed"));
              })
            }
          >
            {t("twoFactor.copyCodes")}
          </Button>
        </div>
        {said}
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={stored}
            aria-invalid={storeError}
            {...(storeError ? { "aria-describedby": `${id}-store` } : {})}
            onChange={(event) => {
              setStored(event.currentTarget.checked);
              setStoreError(false);
            }}
            className="size-6 flex-none accent-ink"
          />
          {t("twoFactor.stored")}
        </label>
        {storeError && (
          <p id={`${id}-store`} className="text-small text-danger">
            {t("twoFactor.storeFirst")}
          </p>
        )}
        <Button
          aria-disabled={!stored}
          onClick={() => {
            if (stored) onEnabled();
            else setStoreError(true);
          }}
        >
          {t("twoFactor.done")}
        </Button>
      </div>
    );
  }

  const key = keyOf(setup.totpURI);
  return (
    <form
      noValidate
      className="mt-4"
      onSubmit={(event) => {
        event.preventDefault();
        void check(setup);
      }}
    >
      {failure}
      <ol className="flex list-decimal flex-col gap-4 pl-5">
        <li className="flex flex-col items-start gap-2">
          <p ref={first} tabIndex={-1}>
            {t("twoFactor.step1")}
          </p>
          <QrCode uri={setup.totpURI} label={t("twoFactor.qr")} />
        </li>
        {key !== null && (
          <li className="flex flex-col items-start gap-2">
            <p>{t("twoFactor.step2")}</p>
            <p className="font-mono text-pinyin break-all">{key}</p>
            <Button
              variant="outline"
              onClick={() =>
                void copy(key.replaceAll(" ", "")).then((done) => {
                  setStatus(done ? t("twoFactor.keyCopied") : t("twoFactor.copyFailed"));
                })
              }
            >
              {t("twoFactor.copyKey")}
            </Button>
            {said}
          </li>
        )}
        <li className="flex flex-col items-start gap-2">
          <p>{t("twoFactor.step3", { length: TOTP_LENGTH })}</p>
          <CodeField
            numeric
            inputRef={null}
            label={t("twoFactor.code")}
            value={code}
            maxLength={TOTP_LENGTH}
            error={fieldError}
            onChange={(value) => {
              setCode(value);
              setFieldError(null);
            }}
          />
          <Button type="submit" aria-disabled={busy}>
            {t("twoFactor.verify")}
          </Button>
        </li>
      </ol>
    </form>
  );
};
