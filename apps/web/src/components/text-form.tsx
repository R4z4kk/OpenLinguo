import { Link, useNavigate } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { ChevronLeft, Info } from "lucide-react";
import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, buttonVariants } from "@/components/ui/button";
import { database } from "@/data/database";
import { describeFailure } from "@/data/review-log";
import { clearStagedFile, rememberSaved, stagedFile } from "@/data/text-handoff";
import {
  characterCount,
  MAX_TEXT_CHARACTERS,
  saveText,
  TITLE_MAX,
  type TextFailure,
} from "@/data/texts";
import { looksTraditional } from "@/data/traditional-script";
import { formatSize } from "@/lib/format-size";

const ANNOUNCE_AFTER_MS = 1000;

const failureMessage = (t: TFunction, failure: TextFailure): string => {
  switch (failure.kind) {
    case "empty":
      return t("library.saveFailed.empty");
    case "too-long":
      return t("library.saveFailed.tooLong", { max: failure.max });
    case "title-too-long":
      return t("library.saveFailed.titleTooLong", { max: failure.max });
    default:
      return t("library.saveFailed.storage", { reason: describeFailure(failure) });
  }
};

/** The one form of « Coller un texte » and « Importer un .txt »: a title and the text, both editable. */
export const TextForm = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const ids = useId();
  const [file] = useState(stagedFile);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState(file?.text ?? "");
  const [failure, setFailure] = useState<TextFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [announced, setAnnounced] = useState("");
  const bodyField = useRef<HTMLTextAreaElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);

  const count = characterCount(body.trim());
  const over = count > MAX_TEXT_CHARACTERS;
  const deferred = useDeferredValue(body);
  const traditional = useMemo(() => looksTraditional(deferred), [deferred]);
  const summary = over
    ? t("library.tooLong", { count, max: MAX_TEXT_CHARACTERS, excess: count - MAX_TEXT_CHARACTERS })
    : count === 0
      ? ""
      : t("library.count", { count, max: MAX_TEXT_CHARACTERS });

  useEffect(() => {
    (file === null ? bodyField : saveButton).current?.focus();
  }, [file]);

  // The count is announced once typing pauses, or when the field is left, not at every key.
  useEffect(() => {
    const timer = setTimeout(() => {
      setAnnounced(summary);
    }, ANNOUNCE_AFTER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [summary]);

  const save = async (): Promise<void> => {
    if (busy || over) return;
    setBusy(true);
    const saved = await saveText(
      database,
      { title, body, source: file === null ? "paste" : "file" },
      Date.now(),
      crypto.randomUUID(),
    );
    if (!saved.ok) {
      setFailure(saved.error);
      setBusy(false);
      if (saved.error.kind === "empty") bodyField.current?.focus();
      return;
    }
    clearStagedFile();
    rememberSaved(saved.value.title);
    void navigate({ to: "/read" });
  };

  const hints = [`${ids}-count`, ...(traditional ? [`${ids}-traditional`] : [])].join(" ");
  const bodyDescription = over ? `${ids}-error ${hints}` : hints;
  return (
    <section aria-labelledby={`${ids}-title`} className="max-w-2xl">
      <Link
        to="/read"
        onClick={clearStagedFile}
        className="-mt-3 mb-1 flex min-h-11 w-fit items-center gap-1"
      >
        <ChevronLeft aria-hidden="true" className="size-5" />
        {t("library.back")}
      </Link>
      <h1 id={`${ids}-title`} className="text-title">
        {t(file === null ? "library.pasteTitle" : "library.importTitle")}
      </h1>
      <p className="mt-2 text-muted">{t("library.formIntro")}</p>
      {file !== null && (
        <>
          <p className="mt-6">
            <span lang="zh-Hans" className="font-zh">
              {file.name}
            </span>
            {" · "}
            {formatSize(file.bytes, i18n.language)}
            {" · "}
            <strong>
              {file.encoding === "GB18030"
                ? t("library.encodingRead", { encoding: file.encoding })
                : file.encoding}
            </strong>
          </p>
          {file.encoding === "GB18030" && (
            <p className="mt-2 text-small text-muted">{t("library.gb18030Help")}</p>
          )}
        </>
      )}
      <div className="mt-6 flex flex-col gap-2">
        <label htmlFor={`${ids}-title-field`} className="font-semibold">
          {t("library.titleLabel")}
        </label>
        <input
          id={`${ids}-title-field`}
          type="text"
          lang="zh-Hans"
          autoComplete="off"
          maxLength={TITLE_MAX}
          aria-describedby={`${ids}-title-help`}
          value={title}
          onChange={(event) => {
            setFailure(null);
            setTitle(event.target.value);
          }}
          className="min-h-12 w-full rounded-control border border-border-strong bg-surface px-3 font-zh text-pinyin"
        />
        <p id={`${ids}-title-help`} className="text-small text-muted">
          {t("library.titleHelp")}
        </p>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <label htmlFor={`${ids}-body`} className="font-semibold">
          {t("library.bodyLabel")}
        </label>
        <textarea
          ref={bodyField}
          id={`${ids}-body`}
          lang="zh-Hans"
          rows={9}
          aria-describedby={bodyDescription}
          aria-invalid={over}
          value={body}
          onChange={(event) => {
            setFailure(null);
            setBody(event.target.value);
          }}
          onBlur={() => {
            setAnnounced(summary);
          }}
          className="w-full resize-y rounded-control border border-border-strong bg-surface p-3 font-zh text-pinyin aria-invalid:border-danger"
        />
        {over && (
          <p id={`${ids}-error`} className="text-danger">
            {summary}
          </p>
        )}
        <p
          id={`${ids}-count`}
          className={over ? "text-small text-danger" : "text-small text-muted"}
        >
          {t("library.count", { count, max: MAX_TEXT_CHARACTERS })}
        </p>
        <p role="status" className="sr-only">
          {announced}
        </p>
      </div>
      {traditional && (
        <div
          id={`${ids}-traditional`}
          className="mt-4 flex gap-3 rounded-card border border-border-strong bg-sunken p-4"
        >
          <Info aria-hidden="true" className="mt-0.5 size-5 flex-none" />
          <div>
            <p className="font-semibold">{t("library.traditionalTitle")}</p>
            <p className="mt-1">{t("library.traditionalBody")}</p>
          </div>
        </div>
      )}
      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          ref={saveButton}
          aria-disabled={over || busy}
          {...(over ? { "aria-describedby": `${ids}-error` } : {})}
          onClick={() => void save()}
          className="aria-disabled:cursor-not-allowed aria-disabled:bg-sunken aria-disabled:text-muted"
        >
          {t("library.save")}
        </Button>
        <Link
          to="/read"
          onClick={clearStagedFile}
          className={buttonVariants({ variant: "outline" })}
        >
          {t("library.cancel")}
        </Link>
      </div>
      {failure !== null && (
        <p role="alert" className="mt-4 text-danger">
          {failureMessage(t, failure)}
        </p>
      )}
    </section>
  );
};
