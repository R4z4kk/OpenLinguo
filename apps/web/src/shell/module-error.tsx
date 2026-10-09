import type { ErrorComponentProps } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

/** Error boundary of one module: the rest of the app stays usable. */
export const ModuleError = ({ error, reset }: ErrorComponentProps) => {
  const { t } = useTranslation();
  return (
    <section role="alert" className="rounded-card border border-border-strong bg-surface p-6">
      <h1 className="text-title">{t("moduleError.title")}</h1>
      <p className="mt-2 text-muted">{error instanceof Error ? error.message : String(error)}</p>
      <Button className="mt-4" onClick={reset}>
        {t("moduleError.retry")}
      </Button>
    </section>
  );
};
