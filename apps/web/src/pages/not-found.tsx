import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const NotFoundPage = () => {
  const { t } = useTranslation();
  return (
    <section>
      <h1 className="text-title">{t("notFound.title")}</h1>
      <Link to="/" className="mt-4 inline-flex min-h-11 items-center underline">
        {t("notFound.back")}
      </Link>
    </section>
  );
};
