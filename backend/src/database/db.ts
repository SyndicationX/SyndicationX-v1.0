// backend/src/database/db.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../schema/schema.js";

const DATABASE_USER = process.env.DATABASE_USER ?? "postgres";
const DATABASE_PASSWORD = process.env.DATABASE_PASSWORD ?? "Postgresql123";
const DATABASE_HOST = process.env.DATABASE_HOST ?? "localhost";
const DATABASE_PORT = process.env.DATABASE_PORT ?? "5432";
const DATABASE_NAME = process.env.DATABASE_NAME ?? "syndicationx_db";
// const DATABASE_NAME = process.env.DATABASE_NAME ?? "11Nov_syndicationx";
// const DATABASE_NAME = process.env.DATABASE_NAME ?? "investor_portal_db";
// const DATABASE_NAME = process.env.DATABASE_NAME ?? "05Nov2026_syndicationx_db";

const DATABASE_URI = `postgresql://${DATABASE_USER}:${DATABASE_PASSWORD}@${DATABASE_HOST}:${DATABASE_PORT}/${DATABASE_NAME}`;

function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]?.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const pool = new Pool({
  connectionString: DATABASE_URI,
  /**
   * Reads are aborted by the SPA after 3s, so an unbounded query only burns a connection
   * that the next request then waits on. Cap it well above normal query time but far below
   * "forever"; migrations and bulk writes still fit, and a runaway plan is killed.
   */
  statement_timeout: envInt("DATABASE_STATEMENT_TIMEOUT_MS", 30_000),
  /** A transaction left open holds row locks that stall every other request on those rows. */
  idle_in_transaction_session_timeout: envInt(
    "DATABASE_IDLE_TX_TIMEOUT_MS",
    30_000,
  ),
  max: envInt("DATABASE_POOL_MAX", 20),
  idleTimeoutMillis: envInt("DATABASE_POOL_IDLE_MS", 30_000),
  /** Fail fast when the pool is saturated instead of queueing behind a spinner. */
  connectionTimeoutMillis: envInt("DATABASE_CONNECTION_TIMEOUT_MS", 5_000),
  keepAlive: true,
});

/** An idle-client crash must not take the API process down with it. */
pool.on("error", (err) => {
  console.error("[db] idle client error:", err.message);
});

/**
 * A checked-out client that loses its connection emits `error` with no listener,
 * which kills the process. The proxy then answers 502 for the request that was
 * in flight — usually the Investors tab, because that read holds connections
 * the longest. Logging here keeps the process up; the query still rejects.
 */
pool.on("connect", (client) => {
  client.on("error", (err: Error) => {
    console.error("[db] client error:", err.message);
  });
});

export const db = drizzle({ client: pool, schema });
export { pool };
