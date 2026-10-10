import { Link } from "@tanstack/react-router";
import { BookA } from "lucide-react";
import { useTranslation } from "react-i18next";

export const LearnPage = () => {
  const { t } = useTranslation();
  return (
    <section>
      <h1 className="text-title">{t("learn.title")}</h1>
      <p className="mt-2 text-muted">{t("learn.intro")}</p>
      <ul className="mt-6 grid max-w-3xl gap-3">
        <li>
          <Link
            to="/learn/dictionary"
            search={{ q: "" }}
            className="flex min-h-11 items-center gap-4 rounded-card border border-hairline bg-surface p-4 hover:bg-sunken"
          >
            <BookA aria-hidden="true" className="size-6 shrink-0" />
            <span>
              <span className="block font-semibold">{t("learn.dictionary")}</span>
              <span className="block text-small text-muted">{t("learn.dictionaryIntro")}</span>
            </span>
          </Link>
        </li>
      </ul>
    </section>
  );
};
