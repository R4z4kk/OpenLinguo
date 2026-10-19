import { Info } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  markNoticeSeen,
  noticeSeen,
  sentItems,
  type AiCall,
  type AiFeature,
} from "@/data/ai-notice";
import { database } from "@/data/database";
import { describeFailure } from "@/data/review-log";

/** The journal and the interests field take free text (GDPR art. 9). */
const SENSITIVE = new Set<AiFeature>(["journal", "interests"]);

const NoticeDialog = ({
  call,
  onConfirm,
  onCancel,
}: {
  readonly call: AiCall;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const confirmed = useRef(false);
  const { feature } = call.payload;
  return (
    <Dialog
      title={t(`aiNotice.features.${feature}.title`)}
      description={`${t(`aiNotice.features.${feature}.intro`)} ${t("aiNotice.machine")}`}
      onClose={() => {
        if (confirmed.current) onConfirm();
        else onCancel();
      }}
    >
      {(close) => (
        <>
          <h3 className="mt-4 font-semibold">{t("aiNotice.whatIsSent")}</h3>
          <p className="mt-1">
            {t("aiNotice.sentTo", {
              provider: t(`aiNotice.providers.${call.provider}`),
              action: call.action,
              items: sentItems(t, i18n.language, call.payload),
            })}
          </p>
          {SENSITIVE.has(feature) && (
            <div className="mt-4 flex gap-2.5 rounded-card border border-border-strong bg-sunken px-4 py-3">
              <Info aria-hidden="true" className="mt-0.5 size-5 flex-none" />
              <p>{t("aiNotice.sensitive")}</p>
            </div>
          )}
          <div className="mt-6 flex flex-wrap gap-2">
            <Button
              onClick={() => {
                confirmed.current = true;
                close();
              }}
            >
              {t(`aiNotice.features.${feature}.confirm`)}
            </Button>
            <Button variant="outline" onClick={close}>
              {t("aiNotice.cancel")}
            </Button>
          </div>
          <p className="mt-3 text-small text-muted">{t(`aiNotice.features.${feature}.once`)}</p>
        </>
      )}
    </Dialog>
  );
};

type Pending = { readonly call: AiCall; readonly run: () => void };

/**
 * `ask` runs an AI call, after its feature's first-use notice the first time (AI Act art. 50(1));
 * cancelling sends nothing. `view` renders the notice, or an alert when it could not be remembered.
 */
export const useAiNotice = (): {
  readonly ask: (call: AiCall, run: () => void) => void;
  readonly view: ReactNode;
} => {
  const { t } = useTranslation();
  const [pending, setPending] = useState<Pending | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const ask = (call: AiCall, run: () => void): void => {
    setFailure(null);
    void noticeSeen(database, call.payload.feature).then((seen) => {
      // Unreadable is shown again: the notice is never skipped.
      if (seen.ok && seen.value) run();
      else setPending({ call, run });
    });
  };

  const confirm = async ({ call, run }: Pending): Promise<void> => {
    setPending(null);
    const marked = await markNoticeSeen(database, call.payload.feature);
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
            call={pending.call}
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
