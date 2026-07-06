#!/usr/bin/env node
// Cockpit setup preflight: verifies every required env var is set (and not a
// placeholder) and that the database is reachable. Run: node scripts/check-setup.mjs
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// --- load .env.local / .env into a merged env (process.env wins) ---
function loadEnvFile(name) {
  const p = resolve(process.cwd(), name);
  if (!existsSync(p)) return {};
  const out = {};
  for (const raw of readFileSync(p, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in out)) out[key] = val;
  }
  return out;
}
const env = { ...loadEnvFile(".env"), ...loadEnvFile(".env.github"), ...loadEnvFile(".env.local"), ...process.env };

const PLACEHOLDERS = [
  "your-", "random-string-of-characters", "xxx", "example.com",
  "your_", "changeme", "pagescms:pagescms@localhost",
];
function isSet(v) {
  if (!v || !String(v).trim()) return false;
  const low = String(v).toLowerCase();
  return !PLACEHOLDERS.some((p) => low.includes(p));
}

const REQUIRED = [
  "BETTER_AUTH_SECRET",
  "CRYPTO_KEY",
  "DATABASE_URL",
  "GITHUB_APP_ID",
  "GITHUB_APP_NAME",
  "GITHUB_APP_CLIENT_ID",
  "GITHUB_APP_CLIENT_SECRET",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_APP_WEBHOOK_SECRET",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "BASE_URL",
];
const OPTIONAL = [
  "GOOGLE_SERVICE_ACCOUNT_JSON_B64",
  "BING_WEBMASTER_API_KEY",
  "WHATCONVERTS_API_TOKEN",
  "WHATCONVERTS_API_SECRET",
  "NETLIFY_PAT",
];

let failed = 0;
console.log("\nCockpit setup preflight\n");
console.log("Required:");
for (const key of REQUIRED) {
  const ok = isSet(env[key]);
  if (!ok) failed++;
  console.log(`  ${ok ? "OK  " : "MISS"}  ${key}`);
}
console.log("\nOptional (analytics tab, safe to skip for now):");
for (const key of OPTIONAL) {
  console.log(`  ${isSet(env[key]) ? "OK  " : "--  "}  ${key}`);
}

// --- database connectivity (best effort) ---
async function checkDb(url) {
  if (!isSet(url)) return { ok: false, msg: "DATABASE_URL not set" };
  if (!/^postgres(ql)?:\/\//.test(url)) return { ok: false, msg: "DATABASE_URL is not a postgres:// URL" };
  let postgres;
  try {
    ({ default: postgres } = await import("postgres"));
  } catch {
    return { ok: false, msg: "run this from your cloned repo after `npm install` (postgres driver not found)" };
  }
  try {
    const sql = postgres(url, { max: 1, connect_timeout: 8, ssl: "prefer" });
    await sql`select 1`;
    await sql.end({ timeout: 3 });
    return { ok: true, msg: "connected" };
  } catch (e) {
    return { ok: false, msg: `connection failed: ${(e && e.message) || e}` };
  }
}

console.log("\nDatabase:");
const db = await checkDb(env.DATABASE_URL);
console.log(`  ${db.ok ? "OK  " : "FAIL"}  ${db.msg}`);
if (!db.ok) failed++;

console.log("");
if (failed === 0) {
  console.log("All good. Open your live URL and log in with the magic link.\n");
  process.exit(0);
} else {
  console.log(`${failed} item(s) need attention above. Fix them in your .env / Vercel env, then re-run.\n`);
  process.exit(1);
}
