import { useTranslation } from "react-i18next";

export const LearnPage = () => {
  const { t } = useTranslation();
  return (
    <section>
      <h1 className="text-title">{t("learn.title")}</h1>
      <p className="mt-2 text-muted">{t("learn.intro")}</p>
    </section>
  );
};
