import type { AiProvenance } from "@openlinguo/core";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

/** Beside every AI output (AI Act art. 50): text and icon, never color alone. */
export const AiBadge = ({ provenance }: { readonly provenance: AiProvenance }) => {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1.5 self-start rounded-full border border-border-strong px-2 py-1 text-caption font-semibold wrap-anywhere">
      <Sparkles aria-hidden="true" className="size-3.5 flex-none" />
      {t("aiNotice.badge", { model: provenance.model })}
    </span>
  );
};
