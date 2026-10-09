import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Button } from "@/components/ui/button";

/** Offers a new version instead of reloading, so a review session is never cut. */
export const UpdatePrompt = () => {
  const { t } = useTranslation();
  const [failure, setFailure] = useState<string | null>(null);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError: (error: unknown) => {
      setFailure(String(error));
    },
  });

  if (failure !== null) {
    return (
      <p role="status" className="mb-6 rounded-card border border-border-strong bg-surface p-4">
        {t("update.offlineUnavailable", { reason: failure })}
      </p>
    );
  }
  if (!needRefresh) return null;
  return (
    <div
      role="status"
      className="mb-6 flex flex-wrap items-center gap-3 rounded-card border border-border-strong bg-surface p-4"
    >
      <p className="flex-1">{t("update.available")}</p>
      <Button onClick={() => void updateServiceWorker(true)}>{t("update.reload")}</Button>
      <Button
        variant="ghost"
        onClick={() => {
          setNeedRefresh(false);
        }}
      >
        {t("update.later")}
      </Button>
    </div>
  );
};
