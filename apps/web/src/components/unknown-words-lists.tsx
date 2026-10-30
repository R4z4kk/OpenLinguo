import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { DownloadControls, describeDownloadFailure } from "@/components/download-controls";
import { database } from "@/data/database";
import { fetchDataFile } from "@/data/import";
import { installLists, listsStatus, removeLists, type ListsStatus } from "@/data/local-lists";

type Loaded =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly reason: string }
  | { readonly status: "ready"; readonly lists: ListsStatus };

/** The two local lists the panel proposes from: their size before the download, then the controls. */
export const UnknownWordsLists = ({ onChange }: { readonly onChange: () => void }) => {
  const { t } = useTranslation();
  const introId = useId();
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    void listsStatus(database, fetchDataFile).then((result) => {
      if (!active) return;
      setLoaded(
        result.ok
          ? { status: "ready", lists: result.value }
          : { status: "failed", reason: describeDownloadFailure(t, result.error) },
      );
    });
    return () => {
      active = false;
    };
  }, [version, t]);

  const reachable =
    loaded.status === "ready" &&
    (loaded.lists.state === "installed" || loaded.lists.bytes !== null);
  return (
    <section className="mt-4">
      <p id={introId} className="text-muted">
        {t("unknownWords.listsIntro")}
      </p>
      {loaded.status === "failed" && (
        <p role="alert" className="mt-3 text-danger">
          {loaded.reason}
        </p>
      )}
      {loaded.status === "ready" &&
        (reachable ? (
          <DownloadControls
            labels="unknownWords"
            bytes={loaded.lists.bytes ?? 0}
            state={loaded.lists.state}
            describedBy={introId}
            install={(onProgress, signal) =>
              installLists(database, fetchDataFile, onProgress, signal)
            }
            remove={() => removeLists(database)}
            onChange={() => {
              setVersion((previous) => previous + 1);
              onChange();
            }}
          />
        ) : (
          <p className="mt-3">{t("unknownWords.listsUnreachable")}</p>
        ))}
    </section>
  );
};
