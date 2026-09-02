#!/usr/bin/env node
import { migrate } from "./migrate.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const applied = await migrate(url);
console.log(applied.length ? `applied: ${applied.join(", ")}` : "no pending migrations");
