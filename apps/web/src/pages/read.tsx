import { useTranslation } from "react-i18next";
import { ReadAloud } from "@/components/read-aloud";
import { TextLibrary } from "@/components/text-library";
import { TextForm } from "@/components/text-form";
import { useData } from "@/data/data-context";

export const ReadPage = () => {
  const { t } = useTranslation();
  const { state } = useData();
  return (
    <section className="max-w-2xl">
      <h1 className="text-title">{t("read.title")}</h1>
      <p className="mt-2 text-muted">{t("read.intro")}</p>
      <TextLibrary pack={state.status === "ready" ? state.pack : null} />
      {state.status === "ready" && <ReadAloud pack={state.pack} />}
    </section>
  );
};

/** Read › Paste a text, or Import a .txt once it is read. */
export const ReadNewPage = () => <TextForm />;
