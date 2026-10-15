import { useTranslation } from "react-i18next";
import { ReadAloud } from "@/components/read-aloud";
import { useData } from "@/data/data-context";

export const ReadPage = () => {
  const { t } = useTranslation();
  const { state } = useData();
  return (
    <section>
      <h1 className="text-title">{t("read.title")}</h1>
      <p className="mt-2 text-muted">{t("read.intro")}</p>
      {state.status === "ready" && <ReadAloud pack={state.pack} />}
    </section>
  );
};
