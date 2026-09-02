import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

/**
 * Minimal forward-only migration runner. Applies every .sql file in
 * migrations/ in filename order exactly once, recording applied names in
 * schema_migrations. Safe to run on every deploy.
 */
export async function migrate(connectionString: string, migrationsDir?: string): Promise<string[]> {
  const dir = migrationsDir ?? join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  const pool = new Pool({
    connectionString,
    ...(/sslmode=require/.test(connectionString) ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  const applied: string[] = [];
  try {
    await pool.query(
      `create table if not exists schema_migrations (
         name text primary key,
         applied_at timestamptz not null default now()
       )`,
    );
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const { rows } = await pool.query(`select 1 from schema_migrations where name = $1`, [file]);
      if (rows.length > 0) continue;
      const sql = await readFile(join(dir, file), "utf8");
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(sql);
        await client.query(`insert into schema_migrations (name) values ($1)`, [file]);
        await client.query("commit");
        applied.push(file);
      } catch (err) {
        await client.query("rollback").catch(() => {});
        throw new Error(`migration ${file} failed: ${String(err)}`);
      } finally {
        client.release();
      }
    }
    return applied;
  } finally {
    await pool.end();
  }
}
