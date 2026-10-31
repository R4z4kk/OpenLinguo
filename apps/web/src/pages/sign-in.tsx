import { Link, useRouter, useSearch } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { AccountGate, SessionFailure, useSession } from "@/components/account-gate";
import { SignInPanel } from "@/components/sign-in-panel";
import { safeReturn } from "@/data/account";

export type SignInSearch = { readonly return: string; readonly error: string | null };

/** `?return=` is a path of this app; `?error=` is set by the OAuth callback (ADR 0015). */
export const validateSignInSearch = (search: Record<string, unknown>): SignInSearch => {
  const error = search["error"];
  return {
    return: safeReturn(search["return"]),
    error: typeof error === "string" && error !== "" ? error : null,
  };
};

const Continue = ({ to }: { readonly to: string }) => {
  const router = useRouter();
  useEffect(() => {
    router.history.replace(to);
  }, [router, to]);
  return null;
};

/** `/account/sign-in`: sign in, then the age step and the second factor, then back to `return`. */
export const SignInPage = () => {
  const { t } = useTranslation();
  const search = validateSignInSearch(useSearch({ strict: false }));
  const { state, reload } = useSession();
  return (
    <section className="max-w-2xl">
      <Link to="/profile/account" className="-mt-3 mb-1 flex min-h-11 w-fit items-center gap-1">
        <ChevronLeft aria-hidden="true" className="size-5" />
        {t("auth.back")}
      </Link>
      <h1 className="text-title">{t("auth.signIn")}</h1>
      <p className="mt-2 text-muted">{t("auth.intro")}</p>
      {state.status === "loading" && (
        <p role="status" className="mt-4 text-muted">
          {t("auth.loading")}
        </p>
      )}
      {state.status === "failed" && <SessionFailure failure={state.failure} onRetry={reload} />}
      {state.status === "loaded" && state.session === null && (
        <SignInPanel returnTo={search.return} providerError={search.error} onSignedIn={reload} />
      )}
      {state.status === "loaded" && state.session !== null && (
        <AccountGate session={state.session} onChange={reload}>
          {() => <Continue to={search.return} />}
        </AccountGate>
      )}
    </section>
  );
};
