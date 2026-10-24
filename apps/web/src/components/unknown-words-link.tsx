import type { AnnotatedToken } from "@openlinguo/core";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { buttonVariants } from "@/components/ui/button";
import { database } from "@/data/database";
import { listUnknownWords } from "@/data/unknown-words";

/** The reader's way to the unknown-words panel, with the number of sequences to look at. */
export const UnknownWordsLink = ({
  id,
  body,
  tokens,
}: {
  readonly id: string;
  readonly body: string;
  readonly tokens: readonly AnnotatedToken[];
}) => {
  const { t } = useTranslation();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    void listUnknownWords(database, body, tokens).then((result) => {
      if (active)
        setCount(
          result.ok ? result.value.filter(({ compositional }) => !compositional).length : null,
        );
    });
    return () => {
      active = false;
    };
  }, [body, tokens]);

  return (
    <Link
      to="/read/$id/unknown"
      params={{ id }}
      className={buttonVariants({ variant: "outline", className: "mt-3" })}
    >
      {count === null ? t("unknownWords.title") : t("unknownWords.open", { count })}
    </Link>
  );
};
