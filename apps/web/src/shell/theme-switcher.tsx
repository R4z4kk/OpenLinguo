import { useState } from "react";
import {
  applyPreference,
  loadPreference,
  savePreference,
  themePreferences,
  type ThemePreference,
} from "@/theme";

const labels: Readonly<Record<ThemePreference, string>> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

const storage = (): Storage => localStorage;

export const ThemeSwitcher = () => {
  const [initial] = useState(() => loadPreference(storage));
  const [preference, setPreference] = useState<ThemePreference>(
    initial.ok ? initial.value : "system",
  );
  const [failure, setFailure] = useState<string | null>(initial.ok ? null : initial.error);

  const choose = (next: ThemePreference): void => {
    setPreference(next);
    applyPreference(document.documentElement, next);
    const saved = savePreference(storage, next);
    setFailure(saved.ok ? null : saved.error);
  };

  return (
    <fieldset>
      <legend className="text-subtitle">Theme</legend>
      <div className="mt-3 inline-flex gap-1 rounded-control border border-border-strong bg-surface p-1">
        {themePreferences.map((option) => (
          <label
            key={option}
            className="flex min-h-11 cursor-pointer items-center rounded-control px-4 has-checked:bg-ink has-checked:font-semibold has-checked:text-on-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink"
          >
            <input
              type="radio"
              name="theme"
              value={option}
              checked={preference === option}
              onChange={() => {
                choose(option);
              }}
              className="sr-only"
            />
            {labels[option]}
          </label>
        ))}
      </div>
      {failure !== null && (
        <p role="alert" className="mt-2 text-danger">
          The theme applies now but cannot be saved in this browser: {failure}
        </p>
      )}
    </fieldset>
  );
};
