import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AccountGate, SessionFailure, useSession } from "@/components/account-gate";
import { AccountPseudonym } from "@/components/account-pseudonym";
import { AccountSignInMethod } from "@/components/account-sign-in-method";
import { AccountSubmissions } from "@/components/account-submissions";
import { AccountTwoFactor } from "@/components/account-two-factor";
import { DEFAULT_RETURN } from "@/data/account";

/** Profile › Compte (`/profile/account`): one section component per subject. */
export const AccountPage = () => {
  const { t } = useTranslation();
  const { state, reload } = useSession();
  const [signedOutNow, setSignedOutNow] = useState(false);
  return (
    <section className="max-w-2xl">
      <Link to="/profile" className="-mt-3 mb-1 flex min-h-11 w-fit items-center gap-1">
        <ChevronLeft aria-hidden="true" className="size-5" />
        {t("profile.title")}
      </Link>
      <h1 className="text-title">{t("account.title")}</h1>
      {state.status === "loading" && (
        <p role="status" className="mt-4 text-muted">
          {t("auth.loading")}
        </p>
      )}
      {state.status === "failed" && <SessionFailure failure={state.failure} onRetry={reload} />}
      {state.status === "loaded" && state.session === null && (
        <>
          <p role="status" className="mt-4">
            {signedOutNow ? t("auth.signedOutNow") : t("auth.signedOut")}
          </p>
          <p className="mt-2">{t("auth.intro")}</p>
          <p className="mt-4">
            <Link
              to="/account/sign-in"
              search={{ return: DEFAULT_RETURN }}
              className="inline-flex min-h-11 items-center underline"
            >
              {t("auth.signIn")}
            </Link>
          </p>
        </>
      )}
      {state.status === "loaded" && state.session !== null && (
        <AccountGate session={state.session} onChange={reload}>
          {(session) => (
            <>
              <AccountSignInMethod
                session={session}
                onSignedOut={() => {
                  setSignedOutNow(true);
                  reload();
                }}
              />
              <AccountPseudonym session={session} onSaved={reload} />
              <AccountTwoFactor session={session} onEnabled={reload} />
              <AccountSubmissions />
            </>
          )}
        </AccountGate>
      )}
    </section>
  );
};
