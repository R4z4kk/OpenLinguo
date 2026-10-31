import { join } from "node:path";
import { migrate } from "drizzle-orm/d1/migrator";
import { getPlatformProxy } from "wrangler";
import { database } from "../schema.ts";

/** The cron Worker's bindings on a migrated local D1 in memory. */
export const migratedPlatform = async () => {
  const platform = await getPlatformProxy<Env>({
    configPath: join(import.meta.dirname, "../../wrangler.jsonc"),
    persist: false,
  });
  await migrate(database(platform.env.DB), {
    migrationsFolder: join(import.meta.dirname, "../../migrations"),
  });
  return platform;
};
