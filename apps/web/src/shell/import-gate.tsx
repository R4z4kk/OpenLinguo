import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useData, type DataFailure } from "@/data/data-context";

const failureMessage = (t: TFunction, failure: DataFailure): string => {
  switch (failure.kind) {
    case "network":
      return t("dataImport.network", { file: failure.file, message: failure.message });
    case "integrity":
      return t("dataImport.integrity", { file: failure.file });
    case "format":
      return t("dataImport.format", { file: failure.file, message: failure.message });
    case "storage":
      return t("dataImport.storage", { file: failure.file, message: failure.message });
    case "dataset-missing":
      return t("dataImport.missing", { dataset: failure.dataset });
    case "storage-failure":
      return t("dataImport.unreadable", { message: failure.message });
  }
};

/** Shows the first-run import (progress, storage persistence, errors) until the data is ready. */
export const ImportGate = ({ children }: { readonly children: ReactNode }) => {
  const { t } = useTranslation();
  const { state, persistence, retry } = useData();
  if (state.status === "ready") return children;

  return (
    <section aria-labelledby="import-title" className="max-w-xl">
      {state.status === "importing" ? (
        <>
          <h1 id="import-title" className="text-title">
            {t("dataImport.title")}
          </h1>
          <progress
            aria-labelledby="import-title"
            max={Math.max(state.progress.total, 1)}
            value={state.progress.rows}
            className="mt-6 h-2 w-full appearance-none overflow-hidden rounded-full bg-sunken [&::-moz-progress-bar]:bg-ink [&::-webkit-progress-bar]:bg-sunken [&::-webkit-progress-value]:bg-ink"
          />
          <p className="mt-2 text-muted" aria-live="polite">
            {t("dataImport.progress", {
              percent:
                state.progress.total === 0
                  ? 0
                  : Math.floor((100 * state.progress.rows) / state.progress.total),
            })}
          </p>
        </>
      ) : (
        <>
          <h1 id="import-title" className="text-title">
            {t("dataImport.failedTitle")}
          </h1>
          <p role="alert" className="mt-2 text-danger">
            {failureMessage(t, state.failure)}
          </p>
          <Button className="mt-4" onClick={retry}>
            {t("dataImport.retry")}
          </Button>
        </>
      )}
      {persistence !== null && (
        <p className="mt-6 text-small text-muted">{t(`persistence.${persistence}`)}</p>
      )}
    </section>
  );
};
