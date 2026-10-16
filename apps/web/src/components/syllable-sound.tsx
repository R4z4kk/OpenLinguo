import { err, ok, type Result } from "@openlinguo/core";
import { toDiacritic } from "@openlinguo/lang-zh";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BandAudio } from "@/components/band-audio";
import { describeDownloadFailure } from "@/components/download-controls";
import { loadAudioPacks, type AudioFailure, type AudioPacks } from "@/data/audio-packs";
import { database } from "@/data/database";
import { fetchDataFile } from "@/data/import";
import { describeFailure, guarded, type ReviewLogFailure } from "@/data/review-log";
import { SYLLABLES_BAND, syllableBand, syllableRecordings } from "@/data/syllable-audio";
import { playInTurn, type Clip } from "@/lib/playback";

export type SyllableAudio = {
  readonly packs: Result<AudioPacks, AudioFailure>;
  /** Reading key (`lu:4`) to `wordAudio` id, empty while the band is not installed. */
  readonly recordings: Result<ReadonlyMap<string, string>, ReviewLogFailure>;
};

const loadSyllableAudio = async (): Promise<SyllableAudio> => ({
  packs: await loadAudioPacks(database, fetchDataFile),
  recordings: await syllableRecordings(database),
});

/** The chart's audio band and its installed recordings, read again after a download or a deletion. */
export const useSyllableAudio = (): {
  readonly audio: SyllableAudio | null;
  readonly refresh: () => void;
} => {
  const [audio, setAudio] = useState<SyllableAudio | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let current = true;
    void loadSyllableAudio().then((loaded) => {
      if (current) setAudio(loaded);
    });
    return () => {
      current = false;
    };
  }, [version]);
  const refresh = useCallback(() => {
    setVersion((count) => count + 1);
  }, []);
  return { audio, refresh };
};

/** `bā` for `ba1`: what was played, written out (WCAG 1.1.1). */
export const spoken = (key: string): string => {
  const marked = toDiacritic(key);
  return marked.ok ? marked.value : key;
};

type Notice = { readonly text: string; readonly failed: boolean };

/** Plays recordings one after the other, only when asked; a new press stops the one playing. */
export const useSyllablePlayer = (
  recordings: ReadonlyMap<string, string>,
): {
  readonly play: (keys: readonly string[]) => Promise<void>;
  readonly notice: Notice | null;
} => {
  const { t } = useTranslation();
  const [notice, setNotice] = useState<Notice | null>(null);
  const playback = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      playback.current?.abort();
    },
    [],
  );

  const play = async (keys: readonly string[]): Promise<void> => {
    playback.current?.abort();
    const found = keys.flatMap((key) => {
      const id = recordings.get(key) ?? null;
      return id === null ? [] : [{ key, id }];
    });
    if (found.length === 0) {
      setNotice({
        text: t("pinyinChart.missing", { syllables: keys.map(spoken).join(", ") }),
        failed: false,
      });
      return;
    }
    const controller = new AbortController();
    playback.current = controller;
    setNotice({
      text: t("pinyinChart.playing", {
        syllables: found.map(({ key }) => spoken(key)).join(", "),
      }),
      failed: false,
    });
    const played = await playInTurn(async () => {
      const rows = await guarded(async () =>
        ok(await database.wordAudio.bulkGet(found.map(({ id }) => id))),
      );
      if (!rows.ok) return err(describeFailure(rows.error));
      const clips: Clip[] = [];
      for (const row of rows.value) {
        const stored = row ?? null;
        if (stored === null) return err(t("audio.gone"));
        clips.push({ kind: "encoded", data: stored.data });
      }
      return ok(clips);
    }, controller.signal);
    if (playback.current !== controller) return;
    playback.current = null;
    if (!played.ok) {
      setNotice({ text: t("review.audioFailed", { reason: played.error }), failed: true });
    }
  };

  return { play, notice };
};

/** Downloads or deletes the chart's recordings, labelled as a synthetic voice (ADR 0007). */
export const SyllableSound = ({
  audio,
  refresh,
}: {
  readonly audio: SyllableAudio | null;
  readonly refresh: () => void;
}) => {
  const { t } = useTranslation();
  const id = useId();
  if (audio === null) return null;
  const { packs, recordings } = audio;
  if (!packs.ok) {
    return packs.error.kind === "cancelled" ? null : (
      <p role="alert" className="mt-10 text-danger">
        {t("audio.unavailable", { reason: describeDownloadFailure(t, packs.error) })}
      </p>
    );
  }
  const band = syllableBand(packs.value.index);
  if (band === null) return null;
  return (
    <section aria-labelledby={id} className="mt-10 max-w-3xl">
      <h2 id={id} className="text-subtitle">
        {t("pinyinChart.sound")}
      </h2>
      <p className="mt-2 text-muted">{t("pinyinChart.soundIntro")}</p>
      <p className="mt-1 text-small text-muted">{t("audio.synthetic")}</p>
      <BandAudio
        pack={packs.value.index}
        band={band}
        state={packs.value.states.get(SYLLABLES_BAND) ?? "absent"}
        describedBy={id}
        onChange={refresh}
      />
      {!recordings.ok && (
        <p role="alert" className="mt-3 text-danger">
          {t("pinyinChart.recordingsFailed", { reason: describeFailure(recordings.error) })}
        </p>
      )}
    </section>
  );
};
