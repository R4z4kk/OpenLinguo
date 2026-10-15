import { ok, type Result } from "@openlinguo/core";
import { Square, Trash2, Volume2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pinyin } from "@/components/pinyin";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useData } from "@/data/data-context";
import { database, type StoredRecording } from "@/data/database";
import { deleteRecording, deleteRecordings, fromPcm16, keptRecordings } from "@/data/recordings";
import { describeFailure, type ReviewLogFailure } from "@/data/review-log";
import { formatSize } from "@/lib/format-size";
import { playInTurn } from "@/lib/playback";

type Notice = { readonly text: string; readonly failed: boolean };

/** The recordings kept from Say it: their size, played or deleted one by one or all. Not in the backup. */
export const RecordingsControls = () => {
  const { t, i18n } = useTranslation();
  const { state } = useData();
  const [recordings, setRecordings] = useState<Result<
    readonly StoredRecording[],
    ReviewLogFailure
  > | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const playback = useRef<AbortController | null>(null);
  const deletedAll = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

  useEffect(() => {
    let current = true;
    void keptRecordings(database).then((result) => {
      if (current) setRecordings(result);
    });
    return () => {
      current = false;
      playback.current?.abort();
    };
  }, []);

  const size = (bytes: number): string => formatSize(bytes, i18n.language);
  const dateTime = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const features = state.status === "ready" ? state.pack.features : null;

  /** Plays a recording; pressed again while it plays, stops. */
  const play = async ({ id, data, sampleRate }: StoredRecording): Promise<void> => {
    const previous = playback.current;
    previous?.abort();
    if (previous !== null && playing === id) return;
    const controller = new AbortController();
    playback.current = controller;
    setPlaying(id);
    const played = await playInTurn(
      () => Promise.resolve(ok([{ kind: "samples", samples: fromPcm16(data), sampleRate }])),
      controller.signal,
    );
    if (playback.current !== controller) return;
    playback.current = null;
    setPlaying(null);
    if (!played.ok) {
      setNotice({ text: t("recordings.playFailed", { reason: played.error }), failed: true });
    }
  };

  const remove = async ({ id, headword }: StoredRecording): Promise<void> => {
    if (playing === id) playback.current?.abort();
    const removed = await deleteRecording(database, id);
    setNotice(
      removed.ok
        ? { text: t("recordings.deleted", { word: headword }), failed: false }
        : {
            text: t("recordings.deleteFailed", { reason: describeFailure(removed.error) }),
            failed: true,
          },
    );
    setRecordings(await keptRecordings(database));
    heading.current?.focus();
  };

  const removeAll = async (close: () => void): Promise<void> => {
    playback.current?.abort();
    const removed = await deleteRecordings(database);
    deletedAll.current = removed.ok;
    setNotice(
      removed.ok
        ? { text: t("recordings.allDeleted"), failed: false }
        : {
            text: t("recordings.deleteFailed", { reason: describeFailure(removed.error) }),
            failed: true,
          },
    );
    setRecordings(await keptRecordings(database));
    close();
  };

  const list = recordings?.ok === true ? recordings.value : [];
  return (
    <section aria-labelledby={headingId} className="mt-6">
      <h3 id={headingId} ref={heading} tabIndex={-1} className="font-semibold">
        {t("recordings.title")}
      </h3>
      <p className="mt-2 text-muted">{t("recordings.intro")}</p>
      {recordings !== null && !recordings.ok && (
        <p role="alert" className="mt-2 text-danger">
          {t("recordings.failed", { reason: describeFailure(recordings.error) })}
        </p>
      )}
      {recordings?.ok === true && list.length === 0 && (
        <p className="mt-2">{t("recordings.none")}</p>
      )}
      {list.length > 0 && (
        <>
          <p className="mt-2">
            {t("recordings.total", {
              count: list.length,
              size: size(list.reduce((total, { data }) => total + data.byteLength, 0)),
            })}
          </p>
          <ul className="mt-3 flex flex-col gap-3">
            {list.map((recording, index) => {
              const wordId = `${headingId}-${String(index)}`;
              return (
                <li key={recording.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span id={wordId}>
                    <span lang="zh-Hans" className="font-zh">
                      {recording.headword}
                    </span>{" "}
                    {features === null ? (
                      <span lang="zh-Latn-pinyin">{recording.readingKey}</span>
                    ) : (
                      <Pinyin reading={recording.readingKey} features={features} className={null} />
                    )}
                  </span>
                  <span className="text-small text-muted">
                    {t("recordings.entry", {
                      date: dateTime.format(recording.recordedAt),
                      size: size(recording.data.byteLength),
                    })}
                  </span>
                  <Button
                    variant="outline"
                    aria-describedby={wordId}
                    onClick={() => void play(recording)}
                  >
                    {playing === recording.id ? (
                      <Square aria-hidden="true" className="size-4" />
                    ) : (
                      <Volume2 aria-hidden="true" className="size-4" />
                    )}
                    {t(playing === recording.id ? "recordings.stop" : "recordings.play")}
                  </Button>
                  <Button
                    variant="ghost"
                    aria-describedby={wordId}
                    onClick={() => void remove(recording)}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                    {t("recordings.delete")}
                  </Button>
                </li>
              );
            })}
          </ul>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => {
              setConfirming(true);
            }}
          >
            <Trash2 aria-hidden="true" className="size-4" />
            {t("recordings.deleteAll")}
          </Button>
        </>
      )}
      <p role="status" className={notice?.failed === true ? "mt-3 text-danger" : "mt-3 text-small"}>
        {notice?.text}
      </p>
      {confirming && (
        <Dialog
          title={t("recordings.deleteAllTitle")}
          description={t("recordings.deleteAllDescription", { count: list.length })}
          onClose={() => {
            setConfirming(false);
            if (deletedAll.current) heading.current?.focus();
            deletedAll.current = false;
          }}
        >
          {(close) => (
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <Button variant="outline" onClick={close}>
                {t("recordings.cancel")}
              </Button>
              <Button variant="danger" onClick={() => void removeAll(close)}>
                <Trash2 aria-hidden="true" className="size-4" />
                {t("recordings.deleteAll")}
              </Button>
            </div>
          )}
        </Dialog>
      )}
    </section>
  );
};
