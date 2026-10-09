import { useTranslation } from "react-i18next";

export const ReadPage = () => {
  const { t } = useTranslation();
  return (
    <section>
      <h1 className="text-title">{t("read.title")}</h1>
      <p className="mt-2 text-muted">{t("read.intro")}</p>
    </section>
  );
};
