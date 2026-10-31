import { JOBS, runJobs } from "./jobs.ts";
import { database } from "./schema.ts";

export default {
  async scheduled(_controller, env) {
    await runJobs(database(env.DB), JOBS);
  },
} satisfies ExportedHandler<Env>;
