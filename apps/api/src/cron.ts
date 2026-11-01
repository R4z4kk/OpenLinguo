import { AuthEnv } from "./auth.ts";
import { JOBS, type Outbox, runJobs } from "./jobs.ts";
import { scalewayMailer } from "./scaleway-mailer.ts";
import { database } from "./schema.ts";

/** Secrets of the cron Worker (apps/api/README.md), for the inactivity notice only. */
const MailEnv = AuthEnv.pick({
  BETTER_AUTH_URL: true,
  SCW_SECRET_KEY: true,
  SCW_PROJECT_ID: true,
  MAIL_FROM: true,
});

const outboxOf = (env: Env) => (): Outbox => {
  const settings = MailEnv.safeParse(env);
  if (!settings.success) {
    const names = settings.error.issues.map(({ path }) => path.join(".")).join(", ");
    throw new Error(`Mail settings missing or invalid: ${names}`);
  }
  const { BETTER_AUTH_URL, SCW_SECRET_KEY, SCW_PROJECT_ID, MAIL_FROM } = settings.data;
  return {
    sendMail: scalewayMailer({
      secretKey: SCW_SECRET_KEY,
      projectId: SCW_PROJECT_ID,
      from: MAIL_FROM,
    }),
    appUrl: BETTER_AUTH_URL,
  };
};

export default {
  async scheduled(_controller, env) {
    await runJobs({ db: database(env.DB), now: new Date(), outbox: outboxOf(env) }, JOBS);
  },
} satisfies ExportedHandler<Env>;
