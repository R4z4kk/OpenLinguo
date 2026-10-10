import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { AboutPage } from "@/pages/about";
import { DictionaryPage, validateDictionarySearch } from "@/pages/dictionary";
import { LearnPage } from "@/pages/learn";
import { NotFoundPage } from "@/pages/not-found";
import { ProfilePage } from "@/pages/profile";
import { ReadPage } from "@/pages/read";
import { TodayPage } from "@/pages/today";
import { WordPage } from "@/pages/word";
import { AppShell } from "@/shell/app-shell";
import { ModuleError } from "@/shell/module-error";

const rootRoute = createRootRoute({
  component: AppShell,
  errorComponent: ModuleError,
  notFoundComponent: NotFoundPage,
});

const getParentRoute = () => rootRoute;

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute, path: "/", component: TodayPage, errorComponent: ModuleError }),
  createRoute({
    getParentRoute,
    path: "/learn",
    component: LearnPage,
    errorComponent: ModuleError,
  }),
  createRoute({
    getParentRoute,
    path: "/learn/dictionary",
    validateSearch: validateDictionarySearch,
    component: DictionaryPage,
    errorComponent: ModuleError,
  }),
  createRoute({
    getParentRoute,
    path: "/learn/dictionary/$word",
    component: WordPage,
    errorComponent: ModuleError,
  }),
  createRoute({ getParentRoute, path: "/read", component: ReadPage, errorComponent: ModuleError }),
  createRoute({
    getParentRoute,
    path: "/profile",
    component: ProfilePage,
    errorComponent: ModuleError,
  }),
  createRoute({
    getParentRoute,
    path: "/profile/about",
    component: AboutPage,
    errorComponent: ModuleError,
  }),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
