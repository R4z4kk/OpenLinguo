import { useTranslation } from "react-i18next";
import { CREDITS, CreditList, type CreditId } from "@/components/credits";

const REPOSITORY = "https://github.com/R4z4kk/OpenLinguo";

/** Every credit, in the order of `CREDITS`. */
const ALL = Object.keys(CREDITS).filter((id): id is CreditId => id in CREDITS);

export const AboutPage = () => {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="about-title" className="max-w-3xl">
      <h1 id="about-title" className="text-title">
        {t("about.title")}
      </h1>
      <p className="mt-4">
        {t("about.license")}{" "}
        <a href={REPOSITORY} className="underline">
          {t("about.source")}
        </a>
      </p>
      <h2 className="mt-8 text-subtitle">{t("about.credits")}</h2>
      <p className="mt-2 text-small text-muted">{t("about.shareAlike")}</p>
      <CreditList ids={ALL} />
    </section>
  );
};
