import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { buttonVariants } from "@/components/ui/button";

export const TodayPage = () => {
  const { t } = useTranslation();
  return (
    <section>
      <h1 className="text-title">{t("today.title")}</h1>
      <p className="mt-2 text-muted">{t("today.intro")}</p>
      <Link to="/review" className={buttonVariants({ className: "mt-6" })}>
        {t("today.start")}
      </Link>
    </section>
  );
};
