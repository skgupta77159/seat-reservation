import fs from "node:fs";
import path from "node:path";
import { pool } from "./pool";

export async function migrate() {
  const migrationPath = path.join(process.cwd(), "migrations", "001_init.sql");

  console.log(`Running migration: ${migrationPath}`);

  const sql = fs.readFileSync(migrationPath, "utf8");

  await pool.query(sql);

  console.log("Migration completed successfully");
}
