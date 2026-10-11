import { ok } from "@openlinguo/core";
import { Volume2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { database } from "@/data/database";
import { describeFailure, guarded } from "@/data/review-log";

/** Plays stored audio from a Blob URL (CSP `media-src blob:`), only when asked. */
export const PlayAudio = ({ audioId }: { readonly audioId: string }) => {
  const { t } = useTranslation();
  const [failure, setFailure] = useState<string | null>(null);

  const play = async (): Promise<void> => {
    const stored = await guarded(async () => ok((await database.audio.get(audioId)) ?? null));
    if (!stored.ok) {
      setFailure(describeFailure(stored.error));
      return;
    }
    if (stored.value === null) {
      setFailure(t("review.audioGone"));
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
    <div className="flex flex-col items-center gap-2">
      <Button variant="outline" onClick={() => void play()}>
        <Volume2 aria-hidden="true" className="size-4" />
        {t("review.playAudio")}
      </Button>
      {failure !== null && (
        <p role="alert" className="text-danger">
          {t("review.audioFailed", { reason: failure })}
        </p>
      )}
    </div>
  );
};
