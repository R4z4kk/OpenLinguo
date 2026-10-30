import { useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ReadAloud } from "@/components/read-aloud";
import { TextReader } from "@/components/reader";
import { StoryForm } from "@/components/story-form";
import { TextLibrary } from "@/components/text-library";
import { TextForm } from "@/components/text-form";
import { UnknownWords } from "@/components/unknown-words";
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

/** Read › Write a story. */
export const ReadStoryPage = () => {
  const { state } = useData();
  return state.status === "ready" && state.pack.prompts !== null ? (
    <StoryForm story={state.pack.prompts.story} language={state.pack.id} />
  ) : null;
};

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

/** Read › the unknown words of a text of the library. */
export const ReadUnknownPage = () => {
  const { state } = useData();
  const id = idParam(useParams({ strict: false }));
  return state.status === "ready" ? <UnknownWords id={id} pack={state.pack} /> : null;
};
