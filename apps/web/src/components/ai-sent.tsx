import { Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { sentItems, type AiCall } from "@/data/ai-notice";

/** « Sent: … » under an AI button, which names `id` in its `aria-describedby`. */
export const AiSent = ({ id, call }: { readonly id: string; readonly call: AiCall }) => {
  const { t, i18n } = useTranslation();
  return (
    <p id={id} className="mt-2 flex items-start gap-1.5 text-small text-muted">
      <Send aria-hidden="true" className="mt-0.5 size-4 flex-none" />
      <span>
        {t("aiNotice.sent", {
          provider: t(`aiNotice.providers.${call.provider}`),
          items: sentItems(t, i18n.language, call.payload),
          action: call.action,
        })}
      </span>
    </p>
  );
};
