import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/shell/language-switcher";
import { ThemeSwitcher } from "@/shell/theme-switcher";

export const ProfilePage = () => {
  const { t } = useTranslation();
  return (
    <section>
      <h1 className="text-title">{t("profile.title")}</h1>
      <h2 className="mt-8 text-subtitle">{t("profile.display")}</h2>
      <div className="mt-4 flex flex-col gap-6">
        <LanguageSwitcher />
        <ThemeSwitcher />
      </div>
    </section>
  );
};
