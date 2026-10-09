import { Link, Outlet } from "@tanstack/react-router";
import { BookOpen, BookText, CalendarCheck, CircleUser } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ImportGate } from "./import-gate.tsx";
import { UpdatePrompt } from "./update-prompt.tsx";

const modules = [
  { to: "/", label: "nav.today", icon: CalendarCheck },
  { to: "/learn", label: "nav.learn", icon: BookOpen },
  { to: "/read", label: "nav.read", icon: BookText },
  { to: "/profile", label: "nav.profile", icon: CircleUser },
] as const;

/** Bottom tabs on mobile, sidebar from 1024px. */
export const AppShell = () => {
  const { t } = useTranslation();
  return (
    <div className="min-h-dvh lg:flex">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-20 focus:rounded-control focus:bg-surface focus:p-3"
      >
        {t("shell.skipToContent")}
      </a>
      <nav
        aria-label={t("shell.navigation")}
        className="fixed inset-x-0 bottom-0 z-10 border-t border-hairline bg-surface pb-[env(safe-area-inset-bottom)] lg:sticky lg:top-0 lg:h-dvh lg:w-60 lg:shrink-0 lg:border-t-0 lg:border-r lg:pb-0"
      >
        <p className="hidden px-6 py-6 text-subtitle lg:block">OpenLinguo</p>
        <ul className="grid grid-cols-4 lg:grid-cols-1 lg:gap-1 lg:px-3">
          {modules.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <Link
                to={to}
                activeOptions={{ exact: to === "/" }}
                className="flex min-h-14 flex-col items-center justify-center gap-1 text-caption text-muted hover:text-ink aria-[current=page]:font-bold aria-[current=page]:text-ink lg:min-h-11 lg:flex-row lg:justify-start lg:gap-3 lg:rounded-control lg:px-3 lg:text-body lg:aria-[current=page]:bg-sunken"
              >
                <Icon aria-hidden="true" className="size-6" />
                {t(label)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main id="main" tabIndex={-1} className="flex-1 px-4 pt-6 pb-24 lg:px-12 lg:pt-10 lg:pb-12">
        <UpdatePrompt />
        <ImportGate>
          <Outlet />
        </ImportGate>
      </main>
    </div>
  );
};
