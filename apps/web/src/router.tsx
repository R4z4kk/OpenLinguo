import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { AboutPage } from "@/pages/about";
import { AnkiImportPage } from "@/pages/anki-import";
import { ChallengePage, ChallengesPage } from "@/pages/challenges";
import { DictionaryPage, validateDictionarySearch } from "@/pages/dictionary";
import { JournalEntryPage, JournalPage } from "@/pages/journal";
import { LearnPage } from "@/pages/learn";
import { NotFoundPage } from "@/pages/not-found";
import { PinyinChartPage } from "@/pages/pinyin-chart";
import { ProfilePage } from "@/pages/profile";
import { ReadNewPage, ReadPage, ReadTextPage, ReadUnknownPage } from "@/pages/read";
import { ReviewPage } from "@/pages/review";
import { TodayPage } from "@/pages/today";
import { TypingDrillPage } from "@/pages/typing-drill";
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
    path: "/review",
    component: ReviewPage,
    errorComponent: ModuleError,
  }),
  createRoute({
    getParentRoute,
    path: "/learn",
    component: LearnPage,
    errorComponent: ModuleError,
  }),
  createRoute({
    getParentRoute,
    path: "/learn/import",
    component: AnkiImportPage,
    errorComponent: ModuleError,
  }),
  createRoute({
    getParentRoute,
    path: "/learn/pinyin",
    component: PinyinChartPage,
    errorComponent: ModuleError,
  }),
  createRoute({
    getParentRoute,
    path: "/learn/typing",
    component: TypingDrillPage,
    errorComponent: ModuleError,
  }),
  createRoute({
    getParentRoute,
    path: "/learn/journal",
    component: JournalPage,
    errorComponent: ModuleError,
  }),
  createRoute({
    getParentRoute,
    path: "/learn/journal/$day",
    component: JournalEntryPage,
    errorComponent: ModuleError,
  }),
  createRoute({
    getParentRoute,
    path: "/learn/challenges",
    component: ChallengesPage,
    errorComponent: ModuleError,
  }),
  createRoute({
    getParentRoute,
    path: "/learn/challenges/$day",
    component: ChallengePage,
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
    path: "/read/new",
    component: ReadNewPage,
    errorComponent: ModuleError,
  }),
  createRoute({
    getParentRoute,
    path: "/read/$id",
    component: ReadTextPage,
    errorComponent: ModuleError,
  }),
  createRoute({
    getParentRoute,
    path: "/read/$id/unknown",
    component: ReadUnknownPage,
    errorComponent: ModuleError,
  }),
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
