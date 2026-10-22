import { useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ReadAloud } from "@/components/read-aloud";
import { TextReader } from "@/components/reader";
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

/** The route param, checked: the router's param types resolve to `any`. */
const idParam = (params: unknown): string =>
  typeof params === "object" && params !== null && "id" in params && typeof params.id === "string"
    ? params.id
    : "";

/** Read › a text of the library. */
export const ReadTextPage = () => {
  const { state } = useData();
  const id = idParam(useParams({ strict: false }));
  return state.status === "ready" ? <TextReader id={id} pack={state.pack} /> : null;
};
