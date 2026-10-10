import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

const subscribe = (onChange: () => void): (() => void) => {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => {
    media.removeEventListener("change", onChange);
  };
};

/** Follows the OS setting live. */
export const useReducedMotion = (): boolean =>
  useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches);
