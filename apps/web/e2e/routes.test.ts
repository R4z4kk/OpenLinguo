import { expect, it, vi } from "vitest";
import { router } from "../src/router.tsx";
import { ROUTE_VISITS } from "./routes.ts";

vi.mock("virtual:pwa-register/react", () => ({ useRegisterSW: () => null }));

it("gives every router path an accessibility visit", () => {
  expect(Object.keys(ROUTE_VISITS).sort()).toEqual(Object.keys(router.routesByPath).sort());
});
