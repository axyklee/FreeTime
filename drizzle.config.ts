import type { Config } from "drizzle-kit";

/**
 * Used only to *generate* SQL migrations from src/db/schema.ts.
 * Applying them is wrangler's job:  npm run db:migrate:local
 */
export default {
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
} satisfies Config;
