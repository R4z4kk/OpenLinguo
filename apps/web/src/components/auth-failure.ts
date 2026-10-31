import { SECOND_FACTOR_LOCK } from "@openlinguo/core/account";
import { useTranslation } from "react-i18next";
import type { ApiFailure } from "@/data/api";

/** One sentence per failure of the account screens; callers answer their own codes first. */
export const useAuthFailure = () => {
  const { t } = useTranslation();
  return (failure: ApiFailure): string => {
    switch (failure.kind) {
      case "offline":
        return t("auth.failure.offline");
      case "rate-limited":
        return failure.retryAfterSeconds === null
          ? t("auth.failure.tooManyLater")
          : t("auth.failure.tooMany", { count: Math.ceil(failure.retryAfterSeconds / 60) });
      case "unexpected":
        return t("auth.failure.unexpected", { status: failure.status });
      case "refused":
        if (failure.code === "MAIL_FAILED") return t("auth.failure.mail");
        if (failure.code === "TOO_MANY_ATTEMPTS")
          return t("auth.twoFactor.locked", { minutes: SECOND_FACTOR_LOCK.minutes });
        return t("auth.failure.unexpected", { status: failure.code });
    }
  };
};
