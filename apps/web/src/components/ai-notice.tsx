import type { AiProvider } from "@openlinguo/core";
import { Info } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { markNoticeSeen, noticeSeen } from "@/data/ai-notice";
import { database } from "@/data/database";
import { describeFailure } from "@/data/review-log";

const NoticeDialog = ({
  provider,
  onConfirm,
  onCancel,
}: {
  readonly provider: AiProvider;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) => {
  const { t } = useTranslation();
  const confirmed = useRef(false);
  const correct = t("correction.correct");
  const uses = [
    t(provider === "local" ? "aiNotice.uses.testNoKey" : "aiNotice.uses.test", {
      action: t("ai.test"),
    }),
    t("aiNotice.uses.challenge", { action: correct, place: t("challenge.title") }),
    t("aiNotice.uses.journal", { action: correct, place: t("journal.title") }),
    t("aiNotice.uses.interests", { action: t("interests.suggest") }),
    t("aiNotice.uses.translation", { action: t("translate.action") }),
    t("aiNotice.uses.story", { action: t("story.generate"), place: t("read.title") }),
  ];
  return (
    <Dialog
      title={t("aiNotice.title")}
      description={`${t("aiNotice.intro")} ${t("aiNotice.machine")}`}
      sheet={null}
      onClose={() => {
        if (confirmed.current) onConfirm();
        else onCancel();
      }}
    >
      {(close) => (
        <>
          <h3 className="mt-4 font-semibold">{t("aiNotice.whatIsSent")}</h3>
          <p className="mt-1">
            {t("aiNotice.sentTo", { provider: t(`aiNotice.providers.${provider}`) })}
          </p>
          <ul className="mt-2 flex list-disc flex-col gap-1 ps-5">
            {uses.map((use) => (
              <li key={use}>{use}</li>
            ))}
          </ul>
          <div className="mt-4 flex gap-2.5 rounded-card border border-border-strong bg-sunken px-4 py-3">
            <Info aria-hidden="true" className="mt-0.5 size-5 flex-none" />
            <p>{t("aiNotice.sensitive")}</p>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button
              onClick={() => {
                confirmed.current = true;
                close();
              }}
            >
              {t("aiNotice.confirm")}
            </Button>
            <Button variant="outline" onClick={close}>
              {t("aiNotice.cancel")}
            </Button>
          </div>
          <p className="mt-3 text-small text-muted">{t("aiNotice.once")}</p>
        </>
      )}
    </Dialog>
  );
};

type Pending = { readonly provider: AiProvider; readonly run: () => void };

/**
 * `ask` runs an AI call, after the AI notice the first time an AI call of any kind is made
 * (AI Act art. 50(1)); cancelling sends nothing. `view` renders the notice, or an alert when it
 * could not be remembered.
 */
export const useAiNotice = (): {
  readonly ask: (provider: AiProvider, run: () => void) => void;
  readonly view: ReactNode;
} => {
  const { t } = useTranslation();
  const [pending, setPending] = useState<Pending | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const ask = (provider: AiProvider, run: () => void): void => {
    setFailure(null);
    void noticeSeen(database).then((seen) => {
      // Unreadable is shown again: the notice is never skipped.
      if (seen.ok && seen.value) run();
      else setPending({ provider, run });
    });
  };

  const confirm = async ({ run }: Pending): Promise<void> => {
    setPending(null);
    const marked = await markNoticeSeen(database);
    if (!marked.ok) {
      setFailure(t("aiNotice.notRemembered", { reason: describeFailure(marked.error) }));
    }
    run();
  };

  return {
    ask,
    view: (
      <>
        {pending !== null && (
          <NoticeDialog
            provider={pending.provider}
            onConfirm={() => void confirm(pending)}
            onCancel={() => {
              setPending(null);
            }}
          />
        )}
        {failure !== null && (
          <p role="alert" className="mt-2 text-small text-danger">
            {failure}
          </p>
        )}
      </>
    ),
  };
};
