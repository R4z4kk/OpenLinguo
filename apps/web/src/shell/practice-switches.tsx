import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/switch";
import { loadSetting, saveSetting, type PresetSetting } from "@/data/daily-goal";
import { PRACTICE_TYPING, PRACTICE_WRITING } from "@/data/practice";

const storage = (): Storage => localStorage;

const settings = { typing: PRACTICE_TYPING, writing: PRACTICE_WRITING } as const;

const PracticeSwitch = ({ name }: { readonly name: keyof typeof settings }) => {
  const { t } = useTranslation();
  const setting: PresetSetting<boolean> = settings[name];
  const [initial] = useState(() => loadSetting(storage, setting));
  const [checked, setChecked] = useState(initial.ok ? initial.value : setting.fallback);
  const [failure, setFailure] = useState<string | null>(initial.ok ? null : initial.error);
  return (
    <div>
      <Switch
        label={t(`practice.${name}`)}
        hint={t(`practice.${name}Hint`)}
        checked={checked}
        onChange={(next) => {
          setChecked(next);
          const saved = saveSetting(storage, setting, next);
          setFailure(saved.ok ? null : saved.error);
        }}
      />
      {failure !== null && (
        <p role="alert" className="mt-2 text-danger">
          {t("goal.notSaved", { reason: failure })}
        </p>
      )}
    </div>
  );
};

/** The session reads the choices when it opens; turning one off keeps the review log. */
export const PracticeSwitches = () => {
  const { t } = useTranslation();
  return (
    <fieldset className="min-w-0">
      <legend className="font-semibold">{t("practice.legend")}</legend>
      <p className="mt-3 text-small text-muted">{t("practice.intro")}</p>
      <div className="mt-3">
        <PracticeSwitch name="typing" />
        <PracticeSwitch name="writing" />
      </div>
      <p className="mt-3 text-small text-muted">{t("practice.kept")}</p>
    </fieldset>
  );
};
