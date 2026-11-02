import { PUBLISHED_CHOICES, type PublishedChoice } from "@openlinguo/core/account";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthFailure } from "@/components/auth-failure";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { deleteAccount, exportAccount } from "@/data/account";
import { listSubmissions } from "@/data/submissions";
import { download } from "@/lib/download";

/** The ADR's default: kept, with no name. */
const DEFAULT_CHOICE: PublishedChoice = "keep-anonymous";
const ORDER: readonly PublishedChoice[] = [
  DEFAULT_CHOICE,
  ...PUBLISHED_CHOICES.filter((choice) => choice !== DEFAULT_CHOICE),
];

/** Profile › Compte › « Mes données »: the export of GDPR art. 15 and 20. */
const AccountExportSection = () => {
  const { t } = useTranslation("auth");
  const describe = useAuthFailure();
  const [state, setState] = useState<
    | { readonly status: "idle" | "working" }
    | { readonly status: "saved"; readonly name: string }
    | { readonly status: "failed"; readonly message: string }
  >({ status: "idle" });

  const exportData = async () => {
    if (state.status === "working") return;
    setState({ status: "working" });
    const result = await exportAccount();
    if (!result.ok) {
      setState({ status: "failed", message: describe(result.error) });
      return;
    }
    const name = `openlinguo-account-${result.value.exportedAt.slice(0, 10)}.json`;
    download(JSON.stringify(result.value, null, 2), name);
    setState({ status: "saved", name });
  };

  return (
    <section aria-labelledby="account-data" className="mt-8">
      <h2 id="account-data" className="text-subtitle">
        {t("data.title")}
      </h2>
      <p className="mt-2">{t("data.intro")}</p>
      <Button
        variant="outline"
        className="mt-3"
        aria-disabled={state.status === "working"}
        onClick={() => void exportData()}
      >
        {t("data.download")}
      </Button>
      <p
        role="status"
        className={state.status === "failed" ? "mt-2 text-danger" : "mt-2 text-small"}
      >
        {state.status === "working" && t("data.downloading")}
        {state.status === "saved" && t("data.downloaded", { name: state.name })}
        {state.status === "failed" && state.message}
      </p>
    </section>
  );
};

/** The modal of the mockups: first focus on « Annuler », a choice for the published texts. */
const DeletionDialog = ({
  onClose,
  onDeleted,
}: {
  readonly onClose: () => void;
  readonly onDeleted: () => void;
}) => {
  const { t } = useTranslation("auth");
  const describe = useAuthFailure();
  const [published, setPublished] = useState<PublishedChoice>(DEFAULT_CHOICE);
  const [hasPublished, setHasPublished] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    // A failure leaves the choice shown: better asked for nothing than lost.
    void listSubmissions().then((listed) => {
      if (active) {
        setHasPublished(!listed.ok || listed.value.some(({ status }) => status === "approved"));
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const remove = async (close: () => void) => {
    if (deleting) return;
    setDeleting(true);
    const result = await deleteAccount(published);
    setDeleting(false);
    if (result.ok) {
      close();
      onDeleted();
    } else setProblem(describe(result.error));
  };

  return (
    <Dialog
      title={t("deletion.dialogTitle")}
      description={t("deletion.dialogBody")}
      sheet={null}
      onClose={onClose}
    >
      {(close) => (
        <>
          {hasPublished && (
            <fieldset className="mt-4 min-w-0">
              <legend className="font-semibold">{t("deletion.published")}</legend>
              {ORDER.map((choice) => (
                <label key={choice} className="flex min-h-11 cursor-pointer items-center gap-3">
                  <input
                    type="radio"
                    name="published"
                    checked={published === choice}
                    onChange={() => {
                      setPublished(choice);
                    }}
                    className="size-5 flex-none accent-ink"
                  />
                  {t(`deletion.choices.${choice}`)}
                </label>
              ))}
              <p className="text-small text-muted">{t("deletion.pending")}</p>
            </fieldset>
          )}
          <p className="mt-4">{t("deletion.copies")}</p>
          <aside className="mt-4 rounded-card border border-hairline bg-sunken p-4">
            <h3 className="font-semibold">{t("deletion.keptTitle")}</h3>
            <p className="mt-1 text-small">{t("deletion.kept")}</p>
          </aside>
          {problem !== null && (
            <p role="alert" className="mt-4 text-danger">
              {problem}
            </p>
          )}
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <Button variant="outline" data-autofocus onClick={close}>
              {t("deletion.cancel")}
            </Button>
            <Button variant="danger" aria-disabled={deleting} onClick={() => void remove(close)}>
              {t("deletion.confirm")}
            </Button>
          </div>
          <p role="status" className="mt-3 text-small">
            {deleting ? t("deletion.deleting") : ""}
          </p>
        </>
      )}
    </Dialog>
  );
};

/** Profile › Compte: « Mes données », then « Supprimer mon compte » (ADR 0015). */
export const AccountData = ({ onDeleted }: { readonly onDeleted: () => void }) => {
  const { t } = useTranslation("auth");
  const [open, setOpen] = useState(false);
  return (
    <>
      <AccountExportSection />
      <section aria-labelledby="account-deletion" className="mt-8">
        <h2 id="account-deletion" className="text-subtitle">
          {t("deletion.title")}
        </h2>
        <p className="mt-2">{t("deletion.intro")}</p>
        <Button
          variant="danger"
          className="mt-3"
          onClick={() => {
            setOpen(true);
          }}
        >
          {t("deletion.open")}
        </Button>
        {open && (
          <DeletionDialog
            onClose={() => {
              setOpen(false);
            }}
            onDeleted={onDeleted}
          />
        )}
      </section>
    </>
  );
};
