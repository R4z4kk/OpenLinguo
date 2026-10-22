import type { LanguagePack } from "@openlinguo/core";
import { Link, useNavigate } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { FileText, PenLine, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { AiBadge } from "@/components/ai-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { database, type StoredText } from "@/data/database";
import { describeFailure, type ReviewLogFailure } from "@/data/review-log";
import {
  describeCoverageFailure,
  knownPercent,
  loadKnownWords,
  measureText,
  wordsToLearn,
  type Measure,
} from "@/data/text-coverage";
import { decodeTextFile, type TextFileFailure } from "@/data/text-file";
import { clearStagedFile, stageFile, takeSaved } from "@/data/text-handoff";
import { deleteText, listTexts } from "@/data/texts";
import { formatSize } from "@/lib/format-size";

type Stats =
  | { readonly status: "ready"; readonly measure: Measure }
  | { readonly status: "failed"; readonly reason: string };

type Notice = { readonly text: string; readonly failed: boolean };

const fileFailureMessage = (t: TFunction, failure: TextFileFailure, language: string): string => {
  switch (failure.kind) {
    case "too-large":
      return t("library.fileFailed.tooLarge", {
        size: formatSize(failure.bytes, language),
        max: formatSize(failure.max, language),
      });
    case "utf-32":
      return t("library.fileFailed.utf32");
    case "unreadable":
      return t("library.fileFailed.unreadable");
    case "empty":
      return t("library.fileFailed.empty");
  }
};

/** The share of known words per text, one text at a time so the list shows at once. */
const useStats = (
  texts: readonly StoredText[] | null,
  pack: LanguagePack | null,
): ReadonlyMap<string, Stats> => {
  const [stats, setStats] = useState<ReadonlyMap<string, Stats>>(new Map());
  const measured = useRef(new Set<string>());
  useEffect(() => {
    const feature = pack?.features.textReading ?? null;
    if (texts === null || pack === null || feature === null) return;
    let active = true;
    const run = async (): Promise<void> => {
      const todo = texts.filter(({ id }) => !measured.current.has(id));
      if (todo.length === 0) return;
      const known = await loadKnownWords(database, pack.id);
      for (const text of todo) {
        const measure = known.ok ? await measureText(feature, known.value, text) : known;
        if (!active) return;
        measured.current.add(text.id);
        const next: Stats = measure.ok
          ? { status: "ready", measure: measure.value }
          : { status: "failed", reason: describeCoverageFailure(measure.error) };
        setStats((previous) => new Map(previous).set(text.id, next));
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [texts, pack]);
  return stats;
};

const CoverageLine = ({ stats }: { readonly stats: Stats | null }) => {
  const { t, i18n } = useTranslation();
  if (stats === null) return <p className="text-muted">{t("library.measuring")}</p>;
  if (stats.status === "failed")
    return (
      <p role="alert" className="text-danger">
        {t("library.measureFailed", { reason: stats.reason })}
      </p>
    );
  if (stats.measure.total === 0) return <p className="text-muted">{t("library.noWords")}</p>;
  const percent = new Intl.NumberFormat(i18n.language, { style: "percent" }).format(
    knownPercent(stats.measure) / 100,
  );
  return (
    <p>
      <strong>{percent}</strong> {t("library.known")} ·{" "}
      {t("library.toLearn", { count: wordsToLearn(stats.measure) })}
    </p>
  );
};

const TextRow = ({
  text,
  stats,
  onDelete,
}: {
  readonly text: StoredText;
  readonly stats: Stats | null;
  readonly onDelete: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }).format(
    text.createdAt,
  );
  return (
    <li className="flex items-start gap-3 rounded-card border border-hairline bg-surface py-3 pr-3 pl-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 lang="zh-Hans" className="font-zh text-pinyin font-semibold wrap-anywhere">
          <Link
            to="/read/$id"
            params={{ id: text.id }}
            className="inline-flex min-h-11 items-center underline"
          >
            {text.title}
          </Link>
        </h3>
        <p className="text-small text-muted">
          {date} · {t(`library.source.${text.source}`)}
        </p>
        <CoverageLine stats={stats} />
        {text.provenance !== null && <AiBadge provenance={text.provenance} />}
      </div>
      <Button
        variant="outline"
        aria-label={t("library.deleteLabel", { title: text.title })}
        onClick={onDelete}
        className="size-11 flex-none px-0"
      >
        <Trash2 aria-hidden="true" className="size-5" />
      </Button>
    </li>
  );
};

/** The Read tab's texts: paste or import one, then each text with its share of known words. */
export const TextLibrary = ({ pack }: { readonly pack: LanguagePack | null }) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [texts, setTexts] = useState<readonly StoredText[] | null>(null);
  const [loadFailure, setLoadFailure] = useState<ReviewLogFailure | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [deleting, setDeleting] = useState<StoredText | null>(null);
  const deleted = useRef(false);
  const stats = useStats(texts, pack);

  useEffect(() => {
    let active = true;
    void listTexts(database).then((listed) => {
      if (!active) return;
      if (listed.ok) setTexts(listed.value);
      else setLoadFailure(listed.error);
      const saved = takeSaved();
      if (saved !== null) setNotice({ text: t("library.saved", { title: saved }), failed: false });
    });
    return () => {
      active = false;
    };
  }, [t]);

  const importFile = async (file: File): Promise<void> => {
    setFileError(null);
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      setFileError(t("library.fileFailed.read", { reason: String(error) }));
      return;
    }
    const decoded = decodeTextFile(bytes);
    if (!decoded.ok) {
      setFileError(fileFailureMessage(t, decoded.error, i18n.language));
      return;
    }
    stageFile({ name: file.name, bytes: bytes.length, ...decoded.value });
    void navigate({ to: "/read/new" });
  };

  const remove = async (text: StoredText, close: () => void): Promise<void> => {
    const result = await deleteText(database, text.id);
    if (!result.ok) {
      setNotice({
        text: t("library.deleteFailed", { reason: describeFailure(result.error) }),
        failed: true,
      });
      close();
      return;
    }
    deleted.current = true;
    setTexts((previous) => previous?.filter(({ id }) => id !== text.id) ?? null);
    setNotice({ text: t("library.deleted"), failed: false });
    close();
  };

  return (
    <>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link to="/read/new" onClick={clearStagedFile} className={buttonVariants()}>
          <PenLine aria-hidden="true" className="size-4" />
          {t("library.paste")}
        </Link>
        <Button
          variant="outline"
          onClick={() => {
            input.current?.click();
          }}
        >
          <FileText aria-hidden="true" className="size-4" />
          {t("library.import")}
        </Button>
        <input
          ref={input}
          type="file"
          accept=".txt,text/plain"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.item(0) ?? null;
            // The same file can be chosen again.
            event.currentTarget.value = "";
            if (file !== null) void importFile(file);
          }}
        />
      </div>
      {fileError !== null && (
        <p role="alert" className="mt-3 text-danger">
          {fileError}
        </p>
      )}
      <h2 ref={heading} tabIndex={-1} className="mt-8 text-subtitle">
        {t("library.listTitle")}
      </h2>
      {loadFailure !== null && (
        <p role="alert" className="mt-3 text-danger">
          {t("library.loadFailed", { reason: describeFailure(loadFailure) })}
        </p>
      )}
      {texts !== null &&
        (texts.length === 0 ? (
          <div className="mt-3 flex flex-col gap-1 rounded-card border border-dashed border-border-strong p-4">
            <p className="font-semibold">{t("library.emptyTitle")}</p>
            <p className="text-muted">{t("library.emptyBody")}</p>
          </div>
        ) : (
          <>
            <p className="mt-1 text-small text-muted">
              {t("library.listSummary", { count: texts.length })}
            </p>
            <ul className="mt-3 flex flex-col gap-3">
              {texts.map((text) => (
                <TextRow
                  key={text.id}
                  text={text}
                  stats={stats.get(text.id) ?? null}
                  onDelete={() => {
                    setDeleting(text);
                  }}
                />
              ))}
            </ul>
          </>
        ))}
      <p role="status" className={notice?.failed === true ? "mt-3 text-danger" : "mt-3 text-small"}>
        {notice?.text}
      </p>
      {deleting !== null && (
        <Dialog
          title={t("library.deleteTitle")}
          description={
            <Trans
              i18nKey="library.deleteBody"
              values={{ title: deleting.title }}
              components={[<span key="title" lang="zh-Hans" className="font-zh" />]}
            />
          }
          onClose={() => {
            setDeleting(null);
            if (deleted.current) heading.current?.focus();
            deleted.current = false;
          }}
        >
          {(close) => (
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <Button variant="outline" onClick={close}>
                {t("library.cancel")}
              </Button>
              <Button variant="danger" onClick={() => void remove(deleting, close)}>
                <Trash2 aria-hidden="true" className="size-4" />
                {t("library.deleteConfirm")}
              </Button>
            </div>
          )}
        </Dialog>
      )}
    </>
  );
};
