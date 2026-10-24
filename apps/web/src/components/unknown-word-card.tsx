import type { LanguageFeatures } from "@openlinguo/core";
import type { TFunction } from "i18next";
import { useEffect, useId, useRef, useState, type SyntheticEvent } from "react";
import { Trans, useTranslation } from "react-i18next";
import { AiBadge } from "@/components/ai-badge";
import { Pinyin } from "@/components/pinyin";
import { Button } from "@/components/ui/button";
import { database } from "@/data/database";
import {
  acceptEntry,
  checkEntry,
  LEXICON_KINDS,
  removeEntry,
  type EntryDraft,
  type EntryFailure,
  type NewEntry,
  type Proposal,
} from "@/data/lexicon";
import { describeFailure } from "@/data/review-log";
import type { UnknownWord } from "@/data/unknown-words";

/** What the card tells the panel, which recomputes the coverage and announces it. */
export type CardEvent =
  { readonly kind: "added" | "removed"; readonly headword: string } | { readonly kind: "rejected" };

type Mode =
  | { readonly kind: "browse" }
  | { readonly kind: "edit"; readonly draft: EntryDraft }
  | { readonly kind: "accepted"; readonly entry: NewEntry };

const proposalKey = ({ source, kind, reading, gloss }: Proposal): string =>
  [source, kind, reading, gloss].join("\t");

const draftOf = (headword: string, proposal: Proposal | null): EntryDraft => ({
  headword,
  kind: proposal?.kind ?? "name",
  reading: proposal?.reading ?? "",
  gloss: proposal?.gloss ?? "",
  source: proposal?.source ?? "learner",
  provenance: proposal?.provenance ?? null,
});

const describeEntryFailure = (t: TFunction, failure: EntryFailure): string => {
  switch (failure.kind) {
    case "not-han":
      return t("unknownWords.failed.notHan");
    case "too-long":
      return t("unknownWords.failed.tooLong", { max: failure.max });
    case "invalid-reading":
      return t("unknownWords.failed.invalidReading", { reading: failure.reading });
  }
};

const INPUT =
  "min-h-12 w-full rounded-control border border-border-strong bg-surface px-3 text-pinyin";

const EntryForm = ({
  initial,
  failure,
  onSave,
  onCancel,
}: {
  readonly initial: EntryDraft;
  readonly failure: string | null;
  readonly onSave: (draft: EntryDraft) => void;
  readonly onCancel: () => void;
}) => {
  const { t } = useTranslation();
  const ids = useId();
  const [draft, setDraft] = useState(initial);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    first.current?.focus();
  }, []);
  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    onSave(draft);
  };
  return (
    <form onSubmit={submit} className="mt-3 grid gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor={`${ids}-headword`} className="font-semibold">
          {t("unknownWords.form.headword")}
        </label>
        <input
          ref={first}
          id={`${ids}-headword`}
          type="text"
          lang="zh-Hans"
          autoComplete="off"
          aria-describedby={`${ids}-headword-help`}
          value={draft.headword}
          onChange={(event) => {
            setDraft({ ...draft, headword: event.target.value });
          }}
          className={`${INPUT} font-zh`}
        />
        <p id={`${ids}-headword-help`} className="text-small text-muted">
          {t("unknownWords.form.headwordHelp")}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${ids}-kind`} className="font-semibold">
          {t("unknownWords.form.kind")}
        </label>
        <select
          id={`${ids}-kind`}
          value={draft.kind}
          onChange={(event) => {
            const kind = LEXICON_KINDS.find((candidate) => candidate === event.target.value);
            if (kind != null) setDraft({ ...draft, kind });
          }}
          className={INPUT}
        >
          {LEXICON_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(`unknownWords.kind.${kind}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${ids}-reading`} className="font-semibold">
          {t("unknownWords.form.reading")}
        </label>
        <input
          id={`${ids}-reading`}
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-describedby={`${ids}-reading-help`}
          value={draft.reading}
          onChange={(event) => {
            setDraft({ ...draft, reading: event.target.value });
          }}
          className={INPUT}
        />
        <p id={`${ids}-reading-help`} className="text-small text-muted">
          {t("unknownWords.form.readingHelp")}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${ids}-gloss`} className="font-semibold">
          {t("unknownWords.form.gloss")}
        </label>
        <input
          id={`${ids}-gloss`}
          type="text"
          autoComplete="off"
          value={draft.gloss}
          onChange={(event) => {
            setDraft({ ...draft, gloss: event.target.value });
          }}
          className={INPUT}
        />
      </div>
      {failure !== null && (
        <p role="alert" className="text-danger">
          {failure}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button type="submit">{t("unknownWords.form.save")}</Button>
        <Button variant="outline" onClick={onCancel}>
          {t("unknownWords.form.cancel")}
        </Button>
      </div>
    </form>
  );
};

const ProposalItem = ({
  proposal,
  features,
  titleId,
  onAccept,
  onEdit,
  onReject,
}: {
  readonly proposal: Proposal;
  readonly features: Pick<LanguageFeatures, "romanization" | "tones">;
  readonly titleId: string;
  readonly onAccept: () => void;
  readonly onEdit: () => void;
  readonly onReject: () => void;
}) => {
  const { t } = useTranslation();
  const id = useId();
  const described = `${id} ${titleId}`;
  return (
    <li className="rounded-control border border-hairline p-3">
      <p id={id} className="font-semibold">
        {t(`unknownWords.source.${proposal.source}`)} · {t(`unknownWords.kind.${proposal.kind}`)}
      </p>
      {proposal.reading !== null && (
        <p className="mt-1">
          <Pinyin reading={proposal.reading} features={features} className={null} />
        </p>
      )}
      {proposal.gloss !== null && <p className="mt-1 wrap-anywhere">{proposal.gloss}</p>}
      {proposal.provenance !== null && (
        <div className="mt-2 flex">
          <AiBadge provenance={proposal.provenance} />
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button aria-describedby={described} onClick={onAccept}>
          {t("unknownWords.accept")}
        </Button>
        <Button variant="outline" aria-describedby={described} onClick={onEdit}>
          {t("unknownWords.edit")}
        </Button>
        <Button variant="outline" aria-describedby={described} onClick={onReject}>
          {t("unknownWords.reject")}
        </Button>
      </div>
    </li>
  );
};

/** One unknown sequence: its sentence, what the steps proposed, and the learner's say. */
export const UnknownWordCard = ({
  word,
  features,
  onEvent,
}: {
  readonly word: UnknownWord;
  readonly features: Pick<LanguageFeatures, "romanization" | "tones">;
  readonly onEvent: (event: CardEvent) => void;
}) => {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const undo = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<Mode>({ kind: "browse" });
  const [rejected, setRejected] = useState<ReadonlySet<string>>(new Set());
  const [failure, setFailure] = useState<string | null>(null);
  const accepted = mode.kind === "accepted";

  useEffect(() => {
    if (accepted) undo.current?.focus();
  }, [accepted]);

  const save = async (draft: EntryDraft): Promise<void> => {
    const checked = checkEntry(draft);
    if (!checked.ok) {
      setFailure(describeEntryFailure(t, checked.error));
      return;
    }
    const stored = await acceptEntry(database, checked.value);
    if (!stored.ok) {
      setFailure(t("unknownWords.failed.storage", { reason: describeFailure(stored.error) }));
      return;
    }
    setFailure(null);
    setMode({ kind: "accepted", entry: checked.value });
    onEvent({ kind: "added", headword: checked.value.headword });
  };

  const revert = async (entry: NewEntry): Promise<void> => {
    const removed = await removeEntry(database, entry.headword);
    if (!removed.ok) {
      setFailure(t("unknownWords.failed.storage", { reason: describeFailure(removed.error) }));
      return;
    }
    setFailure(null);
    setMode({ kind: "browse" });
    onEvent({ kind: "removed", headword: entry.headword });
    requestAnimationFrame(() => heading.current?.focus());
  };

  const leaveForm = (): void => {
    setFailure(null);
    setMode({ kind: "browse" });
    requestAnimationFrame(() => heading.current?.focus());
  };

  if (mode.kind === "accepted") {
    const { entry } = mode;
    return (
      <li className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-hairline bg-sunken p-4">
        <p>
          <Trans
            i18nKey="unknownWords.accepted"
            values={{ headword: entry.headword, kind: t(`unknownWords.kind.${entry.kind}`) }}
            components={[<span key="headword" lang="zh-Hans" className="font-zh font-semibold" />]}
          />
        </p>
        <Button
          ref={undo}
          variant="outline"
          onClick={() => {
            void revert(entry);
          }}
        >
          {t("unknownWords.undo")}
        </Button>
        {failure !== null && (
          <p role="alert" className="w-full text-danger">
            {failure}
          </p>
        )}
      </li>
    );
  }

  const visible = word.proposals.filter((proposal) => !rejected.has(proposalKey(proposal)));
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });
  return (
    <li className="rounded-card border border-hairline bg-surface p-4">
      <h2
        ref={heading}
        id={titleId}
        tabIndex={-1}
        lang="zh-Hans"
        className="font-zh text-title wrap-anywhere"
      >
        {word.text}
      </h2>
      {!word.wikidata && (
        <p className="mt-1 text-small font-semibold text-muted">
          {t("unknownWords.notForWikidata")}
        </p>
      )}
      <p lang="zh-Hans" className="mt-2 font-zh text-pinyin wrap-anywhere">
        {word.before}
        <mark className="bg-transparent font-semibold text-ink underline decoration-2 underline-offset-4">
          {word.text}
        </mark>
        {word.after}
      </p>
      {mode.kind === "edit" ? (
        <EntryForm
          initial={mode.draft}
          failure={failure}
          onSave={(draft) => {
            void save(draft);
          }}
          onCancel={leaveForm}
        />
      ) : (
        <>
          {visible.length === 0 ? (
            <p className="mt-3 text-muted">{t("unknownWords.noProposal")}</p>
          ) : (
            <ul className="mt-3 grid gap-3">
              {visible.map((proposal) => (
                <ProposalItem
                  key={proposalKey(proposal)}
                  proposal={proposal}
                  features={features}
                  titleId={titleId}
                  onAccept={() => {
                    void save(draftOf(word.text, proposal));
                  }}
                  onEdit={() => {
                    setFailure(null);
                    setMode({ kind: "edit", draft: draftOf(word.text, proposal) });
                  }}
                  onReject={() => {
                    setRejected(new Set([...rejected, proposalKey(proposal)]));
                    onEvent({ kind: "rejected" });
                    heading.current?.focus();
                  }}
                />
              ))}
            </ul>
          )}
          {word.checks.map(({ source, checkedAt, found }) => (
            <p key={source} className="mt-2 text-small text-muted">
              {found === 0
                ? t("unknownWords.checkedNone", {
                    source: t(`unknownWords.source.${source}`),
                    date: date.format(checkedAt),
                  })
                : t("unknownWords.checkedFound", {
                    source: t(`unknownWords.source.${source}`),
                    count: found,
                    date: date.format(checkedAt),
                  })}
            </p>
          ))}
          {failure !== null && (
            <p role="alert" className="mt-3 text-danger">
              {failure}
            </p>
          )}
          <div className="mt-3">
            <Button
              variant="outline"
              aria-describedby={titleId}
              onClick={() => {
                setFailure(null);
                setMode({ kind: "edit", draft: draftOf(word.text, null) });
              }}
            >
              {t("unknownWords.fix")}
            </Button>
          </div>
        </>
      )}
    </li>
  );
};
