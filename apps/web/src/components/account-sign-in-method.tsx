import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthFailure } from "@/components/auth-failure";
import { Button } from "@/components/ui/button";
import { loadSignInMethods, type Session, type SignInMethod, signOut } from "@/data/account";
import type { ApiFailure } from "@/data/api";

type Methods =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly failure: ApiFailure }
  | { readonly status: "ready"; readonly methods: readonly SignInMethod[] };

/** Profile › Compte › « Connexion »: the address, how it can sign in, and « Se déconnecter ». */
export const AccountSignInMethod = ({
  session,
  onSignedOut,
}: {
  readonly session: Session;
  readonly onSignedOut: () => void;
}) => {
  const { t, i18n } = useTranslation("auth");
  const describe = useAuthFailure();
  const [methods, setMethods] = useState<Methods>({ status: "loading" });
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadSignInMethods().then((result) => {
      if (!active) return;
      setMethods(
        result.ok
          ? { status: "ready", methods: result.value }
          : { status: "failed", failure: result.error },
      );
    });
    return () => {
      active = false;
    };
  }, []);

  const leave = async () => {
    const result = await signOut();
    if (result.ok) onSignedOut();
    else setProblem(describe(result.error));
  };

  const list = new Intl.ListFormat(i18n.language, { type: "disjunction" });
  return (
    <section aria-labelledby="account-sign-in" className="mt-8">
      <h2 id="account-sign-in" className="text-subtitle">
        {t("signInSection")}
      </h2>
      {methods.status === "ready" && (
        <p className="mt-2">
          {t("method", {
            email: session.user.email,
            methods: list.format(methods.methods.map((method) => t(`methods.${method}`))),
          })}
        </p>
      )}
      {methods.status === "failed" && (
        <p role="alert" className="mt-2 text-danger">
          {describe(methods.failure)}
        </p>
      )}
      {problem !== null && (
        <p role="alert" className="mt-2 text-danger">
          {problem}
        </p>
      )}
      <Button variant="outline" className="mt-3" onClick={() => void leave()}>
        {t("signOut")}
      </Button>
    </section>
  );
};
