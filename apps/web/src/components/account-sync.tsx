import { SYNC_LIMITS } from "@openlinguo/core/sync";
import { liveQuery } from "dexie";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { isShown, toShown, useSyncText, type ShownFailure } from "@/components/sync-text";
import type { Session } from "@/data/account";
import { database, type SyncState } from "@/data/database";
import { deleteStore, holdsChunks } from "@/data/sync-client";
import { turnOff, turnOn, type SyncFailure } from "@/data/sync";
import { requestSync, resetSyncView, useSyncView, type SyncView } from "@/shell/use-sync";

/** What the device remembers: nothing, another account's sync, or this account's. */
export type SyncMode =
  | { readonly kind: "loading" }
  | { readonly kind: "unreadable"; readonly failure: ShownFailure }
  | { readonly kind: "off" }
  | { readonly kind: "other-account" }
  | { readonly kind: "on"; readonly lastSyncAt: number | null };

const modeOf = (state: SyncState | null, accountId: string | null): SyncMode => {
  if (state === null) return { kind: "off" };
  if (state.accountId !== accountId) return { kind: "other-account" };
  return { kind: "on", lastSyncAt: state.lastSyncAt };
};

/** The sync state of the device, followed live so another tab's change shows here. */
const useSyncMode = (
  accountId: string | null,
): { readonly mode: SyncMode; readonly readAt: number } => {
  const [read, setRead] = useState<{ readonly mode: SyncMode; readonly readAt: number }>({
    mode: { kind: "loading" },
    readAt: 0,
  });
  useEffect(() => {
    const subscription = liveQuery(() => database.syncState.get("state")).subscribe({
      next: (state) => {
        setRead({ mode: modeOf(state ?? null, accountId), readAt: Date.now() });
      },
      error: (error: unknown) => {
        setRead({
          mode: { kind: "unreadable", failure: { kind: "storage", message: String(error) } },
          readAt: Date.now(),
        });
      },
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [accountId]);
  return read;
};

/** The three blocks shown before turning sync on and kept under « Ce qui est synchronisé ». */
const Explanation = () => {
  const { t } = useTranslation("auth");
  return (
    <>
      <div>
        <h3 className="font-semibold">{t("sync.sentTitle")}</h3>
        <p className="mt-1">{t("sync.sent")}</p>
      </div>
      <div>
        <h3 className="font-semibold">{t("sync.stayedTitle")}</h3>
        <p className="mt-1">{t("sync.stayed")}</p>
      </div>
      <div>
        <h3 className="font-semibold">{t("sync.knowTitle")}</h3>
        <ul className="mt-1 flex list-disc flex-col gap-2 pl-5">
          <li>{t("sync.know.merge")}</li>
          <li>{t("sync.know.readable")}</li>
          <li>{t("sync.know.off")}</li>
          <li>{t("sync.know.edited")}</li>
          <li>{t("sync.know.law")}</li>
        </ul>
      </div>
    </>
  );
};

const Usage = ({ used }: { readonly used: number }) => {
  const { t } = useTranslation("auth");
  const text = useSyncText();
  const percent = Math.min(100, Math.ceil((used / SYNC_LIMITS.accountBytes) * 100));
  return (
    <div className="flex flex-col gap-2">
      <p className="text-small text-muted">
        {t("sync.usage", {
          used: text.megabytes(used),
          limit: text.megabytes(SYNC_LIMITS.accountBytes),
        })}
      </p>
      <div
        role="img"
        aria-label={t("sync.usageLabel", { ratio: percent / 100 })}
        className="h-2 overflow-hidden rounded-full bg-sunken"
      >
        <div className="h-2 bg-ink" style={{ width: `${String(percent)}%` }} />
      </div>
    </div>
  );
};

/** Profile › Compte › « Synchronisation » (ADR 0016), the part that only depends on what it is given. */
export const SyncPanel = ({
  mode,
  view,
  now,
  headingRef,
  activating,
  problem,
  onActivate,
  onSyncNow,
  onTurnOff,
  serverData,
}: {
  readonly mode: SyncMode;
  readonly view: SyncView;
  readonly now: number;
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
  readonly activating: boolean;
  readonly problem: string | null;
  readonly onActivate: () => void;
  readonly onSyncNow: () => void;
  readonly onTurnOff: () => void;
  readonly serverData: ReactNode;
}) => {
  const { t } = useTranslation("auth");
  const text = useSyncText();
  const failure = view.failure !== null && isShown(view.failure) ? view.failure : null;

  const status = (): string => {
    switch (mode.kind) {
      case "loading":
      case "unreadable":
        return "";
      case "off":
        return activating ? t("sync.activating") : "";
      case "other-account":
        return t("sync.otherAccount");
      case "on":
        if (view.running) return t("sync.running");
        return mode.lastSyncAt === null ? t("sync.never") : text.lastSync(mode.lastSyncAt, now);
    }
  };

  const activate = (label: string) => (
    <Button aria-disabled={activating} onClick={onActivate}>
      {label}
    </Button>
  );

  return (
    <section aria-labelledby="account-sync" className="mt-8">
      <h2 id="account-sync" ref={headingRef} tabIndex={-1} className="text-subtitle">
        {t("sync.title")}
      </h2>
      {mode.kind === "off" && (
        <div className="mt-2 flex flex-col gap-4">
          <p>{t("sync.intro")}</p>
          <Explanation />
        </div>
      )}
      <p role="status" className="mt-2">
        {status()}
      </p>
      {mode.kind === "unreadable" && (
        <p role="alert" className="mt-2 text-danger">
          {text.message(mode.failure)}
        </p>
      )}
      {mode.kind === "on" && failure !== null && (
        <p role="alert" className="mt-2 text-danger">
          {text.message(failure)}
        </p>
      )}
      {problem !== null && (
        <p role="alert" className="mt-2 text-danger">
          {problem}
        </p>
      )}
      {mode.kind === "on" && view.usage !== null && (
        <div className="mt-4">
          <Usage used={view.usage.used} />
        </div>
      )}
      {mode.kind === "on" && (
        <>
          <details className="mt-4 rounded-card border border-hairline bg-surface p-3">
            <summary className="min-h-6 cursor-pointer font-semibold">{t("sync.details")}</summary>
            <div className="mt-3 flex flex-col gap-4">
              <Explanation />
            </div>
          </details>
          <div className="mt-4 flex flex-wrap items-start gap-3">
            {failure?.kind === "turned-off-elsewhere" && activate(t("sync.activate"))}
            <Button variant="outline" aria-disabled={view.running} onClick={onSyncNow}>
              {t("sync.syncNow")}
            </Button>
            <Button variant="danger" onClick={onTurnOff}>
              {t("sync.turnOff")}
            </Button>
          </div>
          <p className="mt-4 text-small text-muted">{t("sync.schedule")}</p>
        </>
      )}
      {mode.kind === "off" && <div className="mt-4">{activate(t("sync.activate"))}</div>}
      {mode.kind === "other-account" && (
        <div className="mt-4 flex flex-col gap-4">
          <Explanation />
          <div>{activate(t("sync.activateHere"))}</div>
        </div>
      )}
      {(mode.kind === "off" || mode.kind === "other-account") && serverData}
    </section>
  );
};

/** Signed out, any state on the device reads as another account's: sync waits for a sign-in. */
export const SyncPausedNotice = ({ mode }: { readonly mode: SyncMode }) => {
  const { t } = useTranslation("auth");
  const text = useSyncText();
  if (mode.kind === "unreadable")
    return (
      <p role="alert" className="mt-4 text-danger">
        {text.message(mode.failure)}
      </p>
    );
  return mode.kind === "other-account" ? <p className="mt-4">{t("sync.paused")}</p> : null;
};

/** A session that ended stops sync: the signed-out page says so rather than leave it silent. */
export const SyncPaused = () => <SyncPausedNotice mode={useSyncMode(null).mode} />;

type DeletionProps = {
  readonly working: boolean;
  readonly problem: string | null;
  readonly onClose: () => void;
  readonly onConfirm: (close: () => void) => void;
};

/** The confirmation of the mockups: first focus on « Annuler », the deletion said in full. */
const DeletionConfirmation = ({
  title,
  body,
  notes,
  confirm,
  working,
  problem,
  onClose,
  onConfirm,
}: DeletionProps & {
  readonly title: string;
  readonly body: string;
  readonly notes: readonly string[];
  readonly confirm: string;
}) => {
  const { t } = useTranslation("auth");
  return (
    <Dialog title={title} description={body} sheet={null} onClose={onClose}>
      {(close) => (
        <>
          {notes.map((note) => (
            <p key={note} className="mt-3">
              {note}
            </p>
          ))}
          {problem !== null && (
            <p role="alert" className="mt-4 text-danger">
              {problem}
            </p>
          )}
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <Button variant="outline" data-autofocus onClick={close}>
              {t("sync.offCancel")}
            </Button>
            <Button
              variant="danger"
              aria-disabled={working}
              onClick={() => {
                onConfirm(close);
              }}
            >
              {confirm}
            </Button>
          </div>
          <p role="status" className="mt-3 text-small">
            {working ? t("sync.offWorking") : ""}
          </p>
        </>
      )}
    </Dialog>
  );
};

export const TurnOffDialog = (props: DeletionProps) => {
  const { t } = useTranslation("auth");
  return (
    <DeletionConfirmation
      title={t("sync.offTitle")}
      body={t("sync.offBody")}
      notes={[t("sync.offLaw")]}
      confirm={t("sync.offConfirm")}
      {...props}
    />
  );
};

/** Unlike a turn-off, the data may not be on this device: the confirmation says it can be lost. */
export const ServerDataDialog = (props: DeletionProps) => {
  const { t } = useTranslation("auth");
  return (
    <DeletionConfirmation
      title={t("sync.server.askTitle")}
      body={t("sync.server.askBody")}
      notes={[t("sync.server.askLoss"), t("sync.server.askLaw")]}
      confirm={t("sync.server.confirm")}
      {...props}
    />
  );
};

/** What the store of the account holds, as far as this device knows. */
export type ServerData = {
  readonly kind: "checking" | "none" | "held" | "failed" | "retrying" | "deleted";
};

/** The block under the section: its heading stays when the button that was pressed goes. */
export const ServerDataBlock = ({
  state,
  headingRef,
  onErase,
  onRetry,
}: {
  readonly state: ServerData;
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
  readonly onErase: () => void;
  readonly onRetry: () => void;
}) => {
  const { t } = useTranslation("auth");
  if (state.kind === "checking" || state.kind === "none") return null;
  return (
    <div className="mt-6 border-t border-hairline pt-4">
      <h3 ref={headingRef} tabIndex={-1} className="font-semibold">
        {t("sync.server.title")}
      </h3>
      {state.kind === "held" && (
        <>
          <p className="mt-1">{t("sync.server.body")}</p>
          <div className="mt-3">
            <Button variant="danger" onClick={onErase}>
              {t("sync.server.erase")}
            </Button>
          </div>
        </>
      )}
      {state.kind === "deleted" && (
        <p role="status" className="mt-1">
          {t("sync.server.erased")}
        </p>
      )}
      {state.kind === "failed" && (
        <p role="alert" className="mt-1 text-danger">
          {t("sync.server.checkFailed")}
        </p>
      )}
      {(state.kind === "failed" || state.kind === "retrying") && (
        <div className="mt-3">
          <Button variant="outline" aria-disabled={state.kind === "retrying"} onClick={onRetry}>
            {t("retry")}
          </Button>
        </div>
      )}
    </div>
  );
};

const readServerData = async (): Promise<ServerData> => {
  const held = await holdsChunks();
  if (!held.ok) return { kind: "failed" };
  return { kind: held.value ? "held" : "none" };
};

/** Mounted while sync is off here, so turning it off again asks the server again (ADR 0016). */
const AccountServerData = ({
  sectionHeading,
}: {
  readonly sectionHeading: RefObject<HTMLHeadingElement | null>;
}) => {
  const { t } = useTranslation("auth");
  const heading = useRef<HTMLHeadingElement>(null);
  const [state, setState] = useState<ServerData>({ kind: "checking" });
  const [asking, setAsking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void readServerData().then((read) => {
      if (current) setState(read);
    });
    return () => {
      current = false;
    };
  }, []);

  const retry = async () => {
    if (state.kind === "retrying") return;
    setState({ kind: "retrying" });
    const read = await readServerData();
    setState(read);
    // « Réessayer » goes unless the check failed again; an empty store takes the whole block.
    if (read.kind === "none") sectionHeading.current?.focus();
    if (read.kind === "held") heading.current?.focus();
  };

  const erase = async (close: () => void) => {
    if (deleting) return;
    setDeleting(true);
    setProblem(null);
    const deleted = await deleteStore();
    setDeleting(false);
    if (!deleted.ok) {
      setProblem(t("sync.server.refused"));
      return;
    }
    setState({ kind: "deleted" });
    close();
    heading.current?.focus();
  };

  return (
    <>
      <ServerDataBlock
        state={state}
        headingRef={heading}
        onErase={() => {
          setProblem(null);
          setAsking(true);
        }}
        onRetry={() => void retry()}
      />
      {asking && (
        <ServerDataDialog
          working={deleting}
          problem={problem}
          onClose={() => {
            setAsking(false);
          }}
          onConfirm={(close) => void erase(close)}
        />
      )}
    </>
  );
};

/** Profile › Compte › « Synchronisation »: turn it on, sync now, turn it off. */
export const AccountSync = ({ session }: { readonly session: Session }) => {
  const { t } = useTranslation("auth");
  const text = useSyncText();
  const { mode, readAt } = useSyncMode(session.user.id);
  const view = useSyncView();
  const heading = useRef<HTMLHeadingElement>(null);
  const [activating, setActivating] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [offProblem, setOffProblem] = useState<string | null>(null);

  const describe = (error: SyncFailure): string => text.message(toShown(error));

  // A sign-in lands here without an app start.
  useEffect(() => {
    void requestSync();
  }, [session.user.id]);

  const activate = async () => {
    if (activating) return;
    setActivating(true);
    setProblem(null);
    const result = await turnOn(database, session.user.id, Date.now());
    setActivating(false);
    if (!result.ok) {
      setProblem(describe(result.error));
      return;
    }
    resetSyncView();
    heading.current?.focus();
    void requestSync(true);
  };

  const deactivate = async (close: () => void) => {
    if (deleting) return;
    setDeleting(true);
    setOffProblem(null);
    const result = await turnOff(database);
    setDeleting(false);
    if (!result.ok) {
      setOffProblem(result.error.kind === "api" ? t("sync.offFailed") : describe(result.error));
      return;
    }
    resetSyncView();
    close();
    heading.current?.focus();
  };

  return (
    <>
      <SyncPanel
        mode={mode}
        view={view}
        now={readAt}
        headingRef={heading}
        activating={activating}
        problem={problem}
        onActivate={() => void activate()}
        onSyncNow={() => {
          if (!view.running) void requestSync(true);
        }}
        onTurnOff={() => {
          setOffProblem(null);
          setAsking(true);
        }}
        serverData={<AccountServerData sectionHeading={heading} />}
      />
      {asking && (
        <TurnOffDialog
          working={deleting}
          problem={offProblem}
          onClose={() => {
            setAsking(false);
          }}
          onConfirm={(close) => void deactivate(close)}
        />
      )}
    </>
  );
};
