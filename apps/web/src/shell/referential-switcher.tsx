import { useTranslation } from "react-i18next";
import { SegmentedControl } from "@/components/segmented-control";
import { useData } from "@/data/data-context";
import { referentials } from "@/data/referential";

export const ReferentialSwitcher = () => {
  const { t } = useTranslation();
  const { referential, referentialFailure, chooseReferential } = useData();
  return (
    <SegmentedControl
      legend={t("referential.legend")}
      name="referential"
      options={referentials.map((value) => ({
        value,
        label: t(`referential.${value}`),
        lang: null,
      }))}
      value={referential}
      onChange={chooseReferential}
      failure={
        referentialFailure === null
          ? null
          : t("referential.notSaved", { reason: referentialFailure })
      }
    />
  );
};
