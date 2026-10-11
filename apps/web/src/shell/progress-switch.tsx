import { useState } from "react";
import { useTranslation } from "react-i18next";
import { loadSetting, saveSetting } from "@/data/daily-goal";
import { SHOW_PROGRESS } from "@/data/progress";

const storage = (): Storage => localStorage;

/** Profile applies the choice at once; Today reads it when it opens. */
export const ProgressSwitch = ({
  shown,
  onChange,
}: {
  readonly shown: boolean;
  readonly onChange: (shown: boolean) => void;
}) => {
  const { t } = useTranslation();
  const [failure, setFailure] = useState(() => {
    const loaded = loadSetting(storage, SHOW_PROGRESS);
    return loaded.ok ? null : loaded.error;
  });
  return (
    <div>
      <label className="flex min-h-11 cursor-pointer items-center gap-2 font-semibold">
        <input
          type="checkbox"
          checked={shown}
          onChange={(event) => {
            const next = event.target.checked;
            onChange(next);
            const saved = saveSetting(storage, SHOW_PROGRESS, next);
            setFailure(saved.ok ? null : saved.error);
          }}
          className="size-5 accent-ink"
        />
        {t("progress.show")}
      </label>
      {failure !== null && (
        <p role="alert" className="mt-2 text-danger">
          {t("goal.notSaved", { reason: failure })}
        </p>
      )}
    </div>
  );
};
