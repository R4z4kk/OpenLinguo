import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SegmentedControl } from "@/components/segmented-control";
import {
  DAILY_GOAL,
  loadSetting,
  NEW_CARDS_PER_DAY,
  saveSetting,
  type PresetSetting,
} from "@/data/daily-goal";

const storage = (): Storage => localStorage;

const settings = { dailyGoal: DAILY_GOAL, newCardsPerDay: NEW_CARDS_PER_DAY } as const;

/** Today and the session read the choice when they open. */
export const GoalSwitcher = ({ name }: { readonly name: keyof typeof settings }) => {
  const { t } = useTranslation();
  const setting: PresetSetting<number> = settings[name];
  const [initial] = useState(() => loadSetting(storage, setting));
  const [value, setValue] = useState(initial.ok ? initial.value : setting.fallback);
  const [failure, setFailure] = useState<string | null>(initial.ok ? null : initial.error);

  return (
    <SegmentedControl
      legend={t(`goal.${name}`)}
      name={name}
      options={setting.values.map((option) => ({
        value: option,
        label: String(option),
        lang: null,
      }))}
      value={value}
      onChange={(next) => {
        setValue(next);
        const saved = saveSetting(storage, setting, next);
        setFailure(saved.ok ? null : saved.error);
      }}
      failure={failure === null ? null : t("goal.notSaved", { reason: failure })}
    />
  );
};
