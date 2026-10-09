import { useTranslation } from "react-i18next";
import { useData } from "@/data/data-context";
import { LanguageSwitcher } from "@/shell/language-switcher";
import { ReferentialSwitcher } from "@/shell/referential-switcher";
import { ThemeSwitcher } from "@/shell/theme-switcher";

export const ProfilePage = () => {
  const { t } = useTranslation();
  const { persistence } = useData();
  return (
    <section>
      <h1 className="text-title">{t("profile.title")}</h1>
      <h2 className="mt-8 text-subtitle">{t("profile.learning")}</h2>
      <div className="mt-4">
        <ReferentialSwitcher />
      </div>
      <h2 className="mt-8 text-subtitle">{t("profile.display")}</h2>
      <div className="mt-4 flex flex-col gap-6">
        <LanguageSwitcher />
        <ThemeSwitcher />
      </div>
      <h2 className="mt-8 text-subtitle">{t("profile.data")}</h2>
      {persistence !== null && <p className="mt-4 text-muted">{t(`persistence.${persistence}`)}</p>}
    </section>
  );
};
