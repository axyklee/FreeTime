import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";

export type Db = DrizzleD1Database<typeof schema>;

/**
 * The D1 binding is only reachable through the Cloudflare request context, so
 * this cannot be a module-level singleton the way a Node database client would
 * be. Drizzle itself is a thin wrapper over the binding, so constructing it per
 * call is cheap.
 */
export async function getDb(): Promise<Db> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.DB) {
    throw new Error(
      "D1 binding `DB` is missing. Run `wrangler d1 create freetime-db`, put the id " +
        "in wrangler.jsonc, then `npm run db:migrate:local`.",
    );
  }
  return drizzle(env.DB, { schema });
}

/** Cloudflare secrets and vars, typed and reachable from server code. */
export async function getEnv(): Promise<CloudflareEnv> {
  const { env } = await getCloudflareContext({ async: true });
  return env;
}

export { schema };
