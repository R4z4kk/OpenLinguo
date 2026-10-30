import type { Result } from "@openlinguo/core";
import { Download, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { ImportFailure } from "@/data/import";
import { browserStorage, requestPersistence } from "@/data/persistence";
import { formatSize } from "@/lib/format-size";

export type DownloadFailure = ImportFailure | { readonly kind: "cancelled" };

/** `installed`: every file is stored; `partial`: an interrupted or older download. */
export type DownloadState = "absent" | "partial" | "installed";

type Downloading = { readonly received: number; readonly total: number };

export const describeDownloadFailure = (t: TFunction, failure: ImportFailure): string => {
  switch (failure.kind) {
    case "network":
      return t("dataImport.network", failure);
    case "integrity":
      return t("dataImport.integrity", failure);
    case "format":
      return t("dataImport.format", failure);
    case "storage":
      return t("dataImport.storage", failure);
  }
};

/**
 * Downloads only when asked, with the size on the button; cancels or deletes. A failure is shown
 * and the button then retries.
 */
export const DownloadControls = ({
  labels,
  bytes,
  state,
  describedBy,
  install,
  remove,
  onChange,
}: {
  /** The `download`, `resume`, `retry`, `downloading`, `installed` and `delete` texts. */
  readonly labels: "audio" | "speech" | "unknownWords";
  readonly bytes: number;
  readonly state: DownloadState;
  readonly describedBy: string;
  readonly install: (
    onProgress: (received: number, total: number) => void,
    signal: AbortSignal,
  ) => Promise<Result<null, DownloadFailure>>;
  readonly remove: () => Promise<Result<null, DownloadFailure>>;
  readonly onChange: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const [downloading, setDownloading] = useState<Downloading | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  // Leaving the page stops the download; it resumes at the next part.
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  const size = (count: number): string => formatSize(count, i18n.language);
  const describe = (error: DownloadFailure): string =>
    error.kind === "cancelled" ? "" : describeDownloadFailure(t, error);

  const download = async (): Promise<void> => {
    const abort = new AbortController();
    controller.current = abort;
    setFailure(null);
    setDownloading({ received: 0, total: bytes });
    await requestPersistence(browserStorage());
    const result = await install((received, total) => {
      setDownloading({ received, total });
    }, abort.signal);
    controller.current = null;
    setDownloading(null);
    if (!result.ok && result.error.kind !== "cancelled") setFailure(describe(result.error));
    onChange();
  };

  const erase = async (): Promise<void> => {
    setFailure(null);
    const result = await remove();
    if (!result.ok) setFailure(describe(result.error));
    onChange();
  };

  if (downloading !== null) {
    return (
      <div className="mt-3 grid gap-2">
        <Progress
          value={downloading.received}
          max={downloading.total}
          aria-label={t(`${labels}.downloading`)}
          aria-describedby={describedBy}
        />
        <p className="text-small text-muted tabular-nums">
          {t("audio.progress", {
            received: size(downloading.received),
            total: size(downloading.total),
          })}
        </p>
        <Button
          variant="outline"
          className="justify-self-start"
          aria-describedby={describedBy}
          onClick={() => controller.current?.abort()}
        >
          {t("audio.cancel")}
        </Button>
      </div>
    );
  }
  const action = failure !== null ? "retry" : state === "partial" ? "resume" : "download";
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {state === "installed" ? (
        <>
          <p className="text-small">{t(`${labels}.installed`, { size: size(bytes) })}</p>
          <Button variant="outline" aria-describedby={describedBy} onClick={() => void erase()}>
            <Trash2 aria-hidden="true" className="size-4" />
            {t(`${labels}.delete`)}
          </Button>
        </>
      ) : (
        <Button variant="outline" aria-describedby={describedBy} onClick={() => void download()}>
          <Download aria-hidden="true" className="size-4" />
          {t(`${labels}.${action}`, { size: size(bytes) })}
        </Button>
      )}
      {failure !== null && (
        <p role="alert" className="w-full text-danger">
          {failure}
        </p>
      )}
    </div>
  );
};
