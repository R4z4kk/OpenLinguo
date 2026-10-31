import { app } from "./app.ts";

/** Mounted by apps/web/functions/api/[[route]].ts on the PWA's origin. */
export const onRequest: PagesFunction<Env> = ({ request, env }) => app.fetch(request, env);
