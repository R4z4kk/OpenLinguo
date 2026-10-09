import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DataProvider } from "@/data/data-context";
import { bindDocumentLanguage, createI18n } from "@/i18n";
import { browserLanguage, loadLanguage } from "@/i18n/language";
import { router } from "@/router";
import { applyPreference, loadPreference } from "@/theme";
import "@fontsource-variable/atkinson-hyperlegible-next";
import "../../../data/font-noto-sans-sc-400/fonts.css";
import "../../../data/font-noto-sans-sc-700/fonts.css";
import "../../../data/font-lxgw-wenkai-gb/fonts.css";
import "./styles.css";

const storage = (): Storage => localStorage;

const theme = loadPreference(storage);
applyPreference(document.documentElement, theme.ok ? theme.value : "system");

const language = loadLanguage(storage, navigator.languages);
bindDocumentLanguage(
  createI18n(language.ok ? language.value : browserLanguage(navigator.languages)),
  document.documentElement,
);

const container = document.getElementById("root");
if (container === null) throw new Error("index.html has no #root element");
createRoot(container).render(
  <StrictMode>
    <DataProvider>
      <RouterProvider router={router} />
    </DataProvider>
  </StrictMode>,
);
