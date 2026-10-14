import { Download, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  bandBytes,
  bandId,
  fetchWithProgress,
  installBand,
  removeBand,
  type AudioFailure,
  type BandState,
} from "@/data/audio-packs";
import { database } from "@/data/database";
import type { AudioPackBand } from "@/data/format";
import type { ImportFailure } from "@/data/import";
import { browserStorage, requestPersistence } from "@/data/persistence";
import { formatSize } from "@/lib/format-size";

type Downloading = { readonly received: number; readonly total: number };

export const describeAudioFailure = (t: TFunction, failure: ImportFailure): string => {
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

/** Downloads, cancels or deletes a band's word audio; a failure is shown, the button then retries. */
export const BandAudio = ({
  release,
  band,
  state,
  describedBy,
  onChange,
}: {
  readonly release: string;
  readonly band: AudioPackBand;
  readonly state: BandState;
  /** The band's heading. */
  readonly describedBy: string;
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
  const size = (bytes: number): string => formatSize(bytes, i18n.language);
  const describe = (error: AudioFailure): string =>
    error.kind === "cancelled" ? "" : describeAudioFailure(t, error);

  const download = async (): Promise<void> => {
    const abort = new AbortController();
    controller.current = abort;
    setFailure(null);
    setDownloading({ received: 0, total: bandBytes(band) });
    await requestPersistence(browserStorage());
    const result = await installBand(
      database,
      release,
      band,
      fetchWithProgress,
      (received, total) => {
        setDownloading({ received, total });
      },
      abort.signal,
    );
    controller.current = null;
    setDownloading(null);
    if (!result.ok && result.error.kind !== "cancelled") setFailure(describe(result.error));
    onChange();
  };

  const remove = async (): Promise<void> => {
    setFailure(null);
    const result = await removeBand(database, bandId(band));
    if (!result.ok) setFailure(describe(result.error));
    onChange();
  };

  if (downloading !== null) {
    return (
      <div className="mt-3 grid gap-2">
        <Progress
          value={downloading.received}
          max={downloading.total}
          aria-label={t("audio.downloading")}
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
          <p className="text-small">{t("audio.installed")}</p>
          <Button variant="outline" aria-describedby={describedBy} onClick={() => void remove()}>
            <Trash2 aria-hidden="true" className="size-4" />
            {t("audio.delete")}
          </Button>
        </>
      ) : (
        <Button variant="outline" aria-describedby={describedBy} onClick={() => void download()}>
          <Download aria-hidden="true" className="size-4" />
          {t(`audio.${action}`, { size: size(bandBytes(band)) })}
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
