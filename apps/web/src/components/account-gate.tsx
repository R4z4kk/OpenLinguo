import type { SessionAnswer } from "@openlinguo/core/account";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AgeStep } from "@/components/age-step";
import { useAuthFailure } from "@/components/auth-failure";
import { SecondFactorPrompt } from "@/components/second-factor-prompt";
import { Button } from "@/components/ui/button";
import { loadSession, type Session, stepOf } from "@/data/account";
import type { ApiFailure } from "@/data/api";

export type SessionState =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly failure: ApiFailure }
  | { readonly status: "loaded"; readonly session: SessionAnswer };

export const useSession = () => {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const [round, setRound] = useState(0);
  useEffect(() => {
    let active = true;
    void loadSession().then((result) => {
      if (!active) return;
      setState(
        result.ok
          ? { status: "loaded", session: result.value }
          : { status: "failed", failure: result.error },
      );
    });
    return () => {
      active = false;
    };
  }, [round]);
  const reload = useCallback(() => {
    setRound((count) => count + 1);
  }, []);
  return { state, reload };
};

export const SessionFailure = ({
  failure,
  onRetry,
}: {
  readonly failure: ApiFailure;
  readonly onRetry: () => void;
}) => {
  const { t } = useTranslation("auth");
  const describe = useAuthFailure();
  return (
    <div className="mt-4 flex flex-col items-start gap-2">
      <p role="alert" className="text-danger">
        {describe(failure)}
      </p>
      <Button variant="outline" onClick={onRetry}>
        {t("retry")}
      </Button>
    </div>
  );
};

/** The age step, then the second factor, before `children` see a usable session. */
export const AccountGate = ({
  session,
  onChange,
  children,
}: {
  readonly session: Session;
  readonly onChange: () => void;
  readonly children: (session: Session) => ReactNode;
}) => {
  const step = stepOf(session);
  if (step === "age") return <AgeStep onDeclared={onChange} />;
  if (step === "second-factor") return <SecondFactorPrompt onDone={onChange} />;
  return children(session);
};
