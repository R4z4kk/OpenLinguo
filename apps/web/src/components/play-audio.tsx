import { ok } from "@openlinguo/core";
import { Volume2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { AudioSource } from "@/data/audio-packs";
import { database } from "@/data/database";
import { describeFailure, guarded } from "@/data/review-log";
import { cn } from "@/lib/utils";

/**
 * Plays stored audio from a Blob URL (CSP `media-src blob:`), only when asked. An audio pack's recording is
 * labelled as a synthetic voice (ADR 0007).
 */
export const PlayAudio = ({
  source,
  align,
}: {
  readonly source: AudioSource;
  readonly align: "center" | "start";
}) => {
  const { t } = useTranslation();
  const [failure, setFailure] = useState<string | null>(null);
  const synthetic = source.table === "wordAudio";

  const play = async (): Promise<void> => {
    const stored = await guarded(async () => {
      const table = source.table === "audio" ? database.audio : database.wordAudio;
      return ok((await table.get(source.id)) ?? null);
    });
    if (!stored.ok) {
      setFailure(describeFailure(stored.error));
      return;
    }
    if (stored.value === null) {
      setFailure(t(synthetic ? "audio.gone" : "review.audioGone"));
      return;
    }
    const url = URL.createObjectURL(new Blob([stored.value.data], { type: stored.value.type }));
    const audio = new Audio(url);
    const release = (): void => {
      URL.revokeObjectURL(url);
    };
    audio.addEventListener("ended", release, { once: true });
    try {
      await audio.play();
      setFailure(null);
    } catch (error) {
      release();
      setFailure(String(error));
    }
  };

  return (
    <div className={cn("flex flex-col gap-1", align === "center" ? "items-center" : "items-start")}>
      <Button variant="outline" onClick={() => void play()}>
        <Volume2 aria-hidden="true" className="size-4" />
        {t("review.playAudio")}
      </Button>
      {synthetic && <p className="text-small text-muted">{t("audio.synthetic")}</p>}
      {failure !== null && (
        <p role="alert" className="text-danger">
          {t("review.audioFailed", { reason: failure })}
        </p>
      )}
    </div>
  );
};
