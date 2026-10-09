import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { router } from "@/router";
import { applyPreference, loadPreference } from "@/theme";
import "./styles.css";

const preference = loadPreference(() => localStorage);
applyPreference(document.documentElement, preference.ok ? preference.value : "system");

const container = document.getElementById("root");
if (container === null) throw new Error("index.html has no #root element");
createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
