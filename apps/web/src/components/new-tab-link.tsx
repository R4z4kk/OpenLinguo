import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export const NewTabLink = ({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) => {
  const { t } = useTranslation();
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-6 items-center gap-1 underline underline-offset-3"
    >
      {children}
      <ExternalLink aria-hidden="true" className="size-3.5 flex-none" />
      <span className="sr-only"> {t("ai.newTab")}</span>
    </a>
  );
};
