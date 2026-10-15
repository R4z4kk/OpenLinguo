import { proficiencyFrameworks, type Result } from "@openlinguo/core";
import type { ZhProficiency } from "@openlinguo/lang-zh";
import { Link } from "@tanstack/react-router";
import { BookA, Grid3x3, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { Suspense, use, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BandAudio, describeAudioFailure } from "@/components/band-audio";
import { Button, buttonVariants } from "@/components/ui/button";
import { NameField } from "@/components/name-field";
import { Dialog } from "@/components/ui/dialog";
import { bandId, loadAudioPacks, type AudioFailure, type AudioPacks } from "@/data/audio-packs";
import { useData } from "@/data/data-context";
import { database } from "@/data/database";
import {
  createDeck,
  DECK_NAME_MAX,
  deckCounts,
  deleteDeck,
  describeDeckFailure,
  localNow,
  renameDeck,
  type DeckCounts,
  type DeckNameFailure,
  type Decks,
  type PersonalDeck,
} from "@/data/decks";
import { fetchDataFile } from "@/data/import";
import { describeFailure, type ReviewLogFailure } from "@/data/review-log";

const COUNTS = ["new", "learning", "due"] as const;

type Loaded = Promise<Result<Decks, ReviewLogFailure>>;

type NamedDeck = PersonalDeck & { readonly name: string };

type Editing = { readonly action: "rename" | "delete"; readonly deck: NamedDeck };

const Counts = ({ counts }: { readonly counts: DeckCounts }) => {
  const { t } = useTranslation();
  return (
    <dl className="mt-2 flex gap-6">
      {COUNTS.map((count) => (
        <div key={count}>
          <dt className="text-small text-muted">{t(`decks.${count}`)}</dt>
          <dd className="text-subtitle tabular-nums">{counts[count]}</dd>
        </div>
      ))}
    </dl>
  );
};

const DeckItem = ({
  name,
  counts,
  actions,
}: {
  readonly name: string;
  readonly counts: DeckCounts;
  /** Controls described by the deck's heading. */
  readonly actions: ((headingId: string) => ReactNode) | null;
}) => {
  const headingId = useId();
  return (
    <li className="rounded-card border border-hairline bg-surface p-4">
      <h3 id={headingId} className="font-semibold">
        {name}
      </h3>
      <Counts counts={counts} />
      {actions === null ? null : actions(headingId)}
    </li>
  );
};

/** Runs one action at a time: clicks and submits while it runs are ignored. */
const useExclusive = () => {
  const pending = useRef(false);
  return async (action: () => Promise<void>): Promise<void> => {
    if (pending.current) return;
    pending.current = true;
    try {
      await action();
    } finally {
      pending.current = false;
    }
  };
};

const useFailureText = () => {
  const { t } = useTranslation();
  return (failure: DeckNameFailure): string =>
    failure.kind === "deck-name"
      ? t(`decks.nameProblem.${failure.problem}`, { max: DECK_NAME_MAX })
      : t("decks.changeFailed", { reason: describeDeckFailure(failure) });
};

const CreateDeck = ({ onCreated }: { readonly onCreated: (name: string) => void }) => {
  const { t } = useTranslation();
  const failureText = useFailureText();
  const exclusive = useExclusive();
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (): Promise<void> =>
    exclusive(async () => {
      const result = await createDeck(database, name);
      if (!result.ok) {
        setProblem(failureText(result.error));
        return;
      }
      setName("");
      setProblem(null);
      onCreated(result.value.name);
    });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="mt-6"
    >
      <NameField label={t("decks.newDeck")} value={name} onChange={setName} problem={problem} />
      <Button type="submit" variant="outline" className="mt-3">
        <Plus aria-hidden="true" className="size-4" />
        {t("decks.create")}
      </Button>
    </form>
  );
};

const RenameForm = ({
  deck,
  close,
  onRenamed,
}: {
  readonly deck: NamedDeck;
  readonly close: () => void;
  readonly onRenamed: (name: string) => void;
}) => {
  const { t } = useTranslation();
  const failureText = useFailureText();
  const exclusive = useExclusive();
  const [name, setName] = useState(deck.name);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (): Promise<void> =>
    exclusive(async () => {
      const result = await renameDeck(database, deck.id, name);
      if (!result.ok) {
        setProblem(failureText(result.error));
        return;
      }
      onRenamed(result.value.name);
      close();
    });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="mt-4"
    >
      <NameField label={t("decks.name")} value={name} onChange={setName} problem={problem} />
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <Button variant="outline" onClick={close}>
          {t("decks.cancel")}
        </Button>
        <Button type="submit">{t("decks.save")}</Button>
      </div>
    </form>
  );
};

/** Cancel comes first and takes the focus: the destructive action is never the default. */
const DeleteConfirm = ({
  deck,
  referential,
  close,
  onDeleted,
}: {
  readonly deck: NamedDeck;
  readonly referential: ZhProficiency;
  readonly close: () => void;
  readonly onDeleted: () => void;
}) => {
  const { t } = useTranslation();
  const exclusive = useExclusive();
  const [failure, setFailure] = useState<string | null>(null);

  const confirm = (): Promise<void> =>
    exclusive(async () => {
      const result = await deleteDeck(database, deck.id, referential);
      if (!result.ok) {
        setFailure(t("decks.changeFailed", { reason: describeDeckFailure(result.error) }));
        return;
      }
      onDeleted();
      close();
    });

  return (
    <>
      {failure !== null && (
        <p role="alert" className="mt-4 text-danger">
          {failure}
        </p>
      )}
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <Button variant="outline" onClick={close}>
          {t("decks.cancel")}
        </Button>
        <Button variant="danger" onClick={() => void confirm()}>
          <Trash2 aria-hidden="true" className="size-4" />
          {t("decks.delete")}
        </Button>
      </div>
    </>
  );
};

const PersonalList = ({
  decks,
  onEdit,
}: {
  readonly decks: Loaded;
  readonly onEdit: (editing: Editing) => void;
}) => {
  const { t } = useTranslation();
  const result = use(decks);
  if (!result.ok)
    return (
      <p role="alert" className="mt-4 text-danger">
        {t("decks.failed", { reason: describeFailure(result.error) })}
      </p>
    );
  return (
    <ul className="mt-4 grid gap-3 sm:grid-cols-2">
      {result.value.personal.map((deck) => {
        const { name } = deck;
        return (
          <DeckItem
            key={deck.id}
            name={name ?? t("decks.myWords")}
            counts={deck.counts}
            actions={
              name === null
                ? null
                : (headingId) => (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="ghost"
                        aria-describedby={headingId}
                        onClick={() => {
                          onEdit({ action: "rename", deck: { ...deck, name } });
                        }}
                      >
                        <Pencil aria-hidden="true" className="size-4" />
                        {t("decks.rename")}
                      </Button>
                      <Button
                        variant="ghost"
                        aria-describedby={headingId}
                        onClick={() => {
                          onEdit({ action: "delete", deck: { ...deck, name } });
                        }}
                      >
                        <Trash2 aria-hidden="true" className="size-4" />
                        {t("decks.delete")}
                      </Button>
                    </div>
                  )
            }
          />
        );
      })}
    </ul>
  );
};

const PersonalDecks = ({
  decks,
  referential,
  refresh,
}: {
  readonly decks: Loaded;
  readonly referential: ZhProficiency;
  readonly refresh: () => void;
}) => {
  const { t } = useTranslation();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  // The browser gives focus back to the button that opened the dialog, gone after a deletion.
  const focusAfterClose = useRef<HTMLElement | null>(null);

  const changed = (message: string): void => {
    setNotice(message);
    refresh();
  };

  return (
    <section aria-labelledby={headingId} className="mt-10 max-w-3xl">
      <h2 id={headingId} ref={heading} tabIndex={-1} className="text-subtitle">
        {t("decks.personal")}
      </h2>
      <p className="mt-2 text-muted">{t("decks.personalIntro")}</p>
      <Suspense fallback={null}>
        <PersonalList decks={decks} onEdit={setEditing} />
      </Suspense>
      <CreateDeck
        onCreated={(name) => {
          changed(t("decks.created", { name }));
        }}
      />
      <Link
        to="/learn/import"
        className={buttonVariants({ variant: "outline", className: "mt-6" })}
      >
        <Upload aria-hidden="true" className="size-4" />
        {t("decks.importAnki")}
      </Link>
      <p role="status" className="mt-3 text-small">
        {notice}
      </p>
      {editing !== null && (
        <Dialog
          title={t(editing.action === "rename" ? "decks.renameTitle" : "decks.deleteTitle", {
            name: editing.deck.name,
          })}
          description={
            editing.action === "delete" ? t("decks.leaving", { count: editing.deck.leaving }) : null
          }
          onClose={() => {
            setEditing(null);
            focusAfterClose.current?.focus();
            focusAfterClose.current = null;
          }}
        >
          {(close) =>
            editing.action === "rename" ? (
              <RenameForm
                deck={editing.deck}
                close={close}
                onRenamed={(name) => {
                  changed(t("decks.renamed", { name }));
                }}
              />
            ) : (
              <DeleteConfirm
                deck={editing.deck}
                referential={referential}
                close={close}
                onDeleted={() => {
                  focusAfterClose.current = heading.current;
                  changed(t("decks.deleted", { name: editing.deck.name }));
                }}
              />
            )
          }
        </Dialog>
      )}
    </section>
  );
};

const BandList = ({
  decks,
  audio,
  referential,
  refreshAudio,
}: {
  readonly decks: Loaded;
  readonly audio: Promise<Result<AudioPacks, AudioFailure>>;
  readonly referential: ZhProficiency;
  readonly refreshAudio: () => void;
}) => {
  const { t } = useTranslation();
  const result = use(decks);
  const packs = use(audio);
  // A read failure is shown once, with the personal decks.
  if (!result.ok) return null;
  const levels = proficiencyFrameworks[referential];
  const audioOf = (level: number) => {
    if (!packs.ok) return null;
    const { index, states } = packs.value;
    const band =
      index.bands.find((entry) => entry.referential === referential && entry.level === level) ??
      null;
    if (band === null) return null;
    return (headingId: string) => (
      <BandAudio
        pack={index}
        band={band}
        state={states.get(bandId(band)) ?? "absent"}
        describedBy={headingId}
        onChange={refreshAudio}
      />
    );
  };
  return (
    <>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {result.value.bands.map((counts, index) => {
          const name = t("dictionary.level", { level: levels[index] ?? String(index + 1) });
          return <DeckItem key={name} name={name} counts={counts} actions={audioOf(index + 1)} />;
        })}
      </ul>
      {!packs.ok && packs.error.kind !== "cancelled" && (
        <p role="alert" className="mt-4 text-danger">
          {t("audio.unavailable", { reason: describeAudioFailure(t, packs.error) })}
        </p>
      )}
    </>
  );
};

const DeckSections = ({ referential }: { readonly referential: ZhProficiency }) => {
  const { t } = useTranslation();
  const bandsId = useId();
  const load = () => deckCounts(database, referential, localNow());
  // Read once per visit and after each change: words filed on a word page show up when coming back.
  const [decks, setDecks] = useState(load);
  // The lists stay on screen, with their focus, while the new counts load.
  const [, startTransition] = useTransition();
  const refresh = (): void => {
    startTransition(() => {
      setDecks(load());
    });
  };
  const loadAudio = () => loadAudioPacks(database, fetchDataFile);
  const [audio, setAudio] = useState(loadAudio);
  const refreshAudio = (): void => {
    startTransition(() => {
      setAudio(loadAudio());
    });
  };
  return (
    <>
      <PersonalDecks decks={decks} referential={referential} refresh={refresh} />
      <section aria-labelledby={bandsId} className="mt-10 max-w-3xl">
        <h2 id={bandsId} className="text-subtitle">
          {t("decks.bands")}
        </h2>
        <p className="mt-2 text-muted">
          {t("decks.bandsIntro", { referential: t(`referential.${referential}`) })}
        </p>
        <Suspense fallback={null}>
          <BandList
            decks={decks}
            audio={audio}
            referential={referential}
            refreshAudio={refreshAudio}
          />
        </Suspense>
      </section>
    </>
  );
};

export const LearnPage = () => {
  const { t } = useTranslation();
  const { referential } = useData();
  return (
    <section>
      <h1 className="text-title">{t("learn.title")}</h1>
      <p className="mt-2 text-muted">{t("learn.intro")}</p>
      <ul className="mt-6 grid max-w-3xl gap-3">
        <li>
          <Link
            to="/learn/dictionary"
            search={{ q: "" }}
            className="flex min-h-11 items-center gap-4 rounded-card border border-hairline bg-surface p-4 hover:bg-sunken"
          >
            <BookA aria-hidden="true" className="size-6 shrink-0" />
            <span>
              <span className="block font-semibold">{t("learn.dictionary")}</span>
              <span className="block text-small text-muted">{t("learn.dictionaryIntro")}</span>
            </span>
          </Link>
        </li>
        <li>
          <Link
            to="/learn/pinyin"
            className="flex min-h-11 items-center gap-4 rounded-card border border-hairline bg-surface p-4 hover:bg-sunken"
          >
            <Grid3x3 aria-hidden="true" className="size-6 shrink-0" />
            <span>
              <span className="block font-semibold">{t("learn.pinyinChart")}</span>
              <span className="block text-small text-muted">{t("learn.pinyinChartIntro")}</span>
            </span>
          </Link>
        </li>
      </ul>
      <DeckSections key={referential} referential={referential} />
    </section>
  );
};
