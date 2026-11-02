import { useId } from "react";
import { useTranslation } from "react-i18next";
import { TwoFactorSetup } from "@/components/two-factor-setup";
import { isAdmin, type Session } from "@/data/account";

/** Profile › Compte › « Vérification en deux étapes »: mandatory for the admin (ADR 0015). */
export const AccountTwoFactor = ({
  session,
  onEnabled,
}: {
  readonly session: Session;
  readonly onEnabled: () => void;
}) => {
  const { t } = useTranslation("auth");
  const id = useId();
  const enabled = session.user.twoFactorEnabled === true;
  return (
    <section aria-labelledby={`${id}-title`} className="mt-8">
      <h2 id={`${id}-title`} className="text-subtitle">
        {t("twoFactor.title")}
      </h2>
      <p className="mt-2">{enabled ? t("twoFactor.on") : t("twoFactor.off")}</p>
      {!enabled && isAdmin(session) && (
        <p className="mt-1 font-semibold">{t("twoFactor.required")}</p>
      )}
      {!enabled && <TwoFactorSetup onEnabled={onEnabled} />}
    </section>
  );
};
