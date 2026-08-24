import { getEnv } from "@/db";

/**
 * Reads configuration, preferring the Cloudflare binding over `process.env`.
 *
 * Workers only expose vars and secrets through the per-request environment, so
 * anything read at module scope would be missing. Falling back to `process.env`
 * keeps the same code working under `next dev` and at build time.
 */
export async function readVar(key: string): Promise<string | undefined> {
  let cf: Record<string, unknown> = {};
  try {
    cf = (await getEnv()) as unknown as Record<string, unknown>;
  } catch {
    // No Cloudflare context (e.g. during build); process.env is enough.
  }
  const value = cf[key] ?? process.env[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The app's public origin, used to build links in outgoing email. */
export async function appOrigin(): Promise<string> {
  const raw = (await readVar("APP_URL")) ?? (await readVar("AUTH_URL")) ?? "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}
