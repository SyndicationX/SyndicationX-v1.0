import pg from "pg";

const pool = new pg.Pool({
  connectionString: "postgresql://postgres:Postgresql123@localhost:5432/postgres",
});
const dbs = await pool.query(
  "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname",
);
console.log(dbs.rows.map((r) => r.datname).join("\n"));
await pool.end();
