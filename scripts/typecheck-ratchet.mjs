#!/usr/bin/env node
/**
 * Typecheck ratchet.
 *
 * `npm run build` uses Vite + SWC, which transpiles without ever typechecking,
 * so the project has been shipping with type errors nobody sees. As of
 * 2026-09-09 there are 172 of them, most caused by src/integrations/supabase/types.ts
 * being ~15 migrations out of date (31 tables the app queries are missing from
 * the generated Database type, which is also why the codebase is full of
 * `as unknown as` casts).
 *
 * Fixing all 172 at once means regenerating types against the live database,
 * which needs credentials this script does not have. Blocking CI on a clean
 * typecheck today would just mean CI is permanently red, which teaches
 * everyone to ignore it.
 *
 * So: ratchet. Record the current count as a baseline, fail if it goes UP,
 * and nag to lower the baseline when it goes DOWN. The debt cannot grow, and
 * it shrinks as types are regenerated.
 *
 * Usage:
 *   node scripts/typecheck-ratchet.mjs            # check against baseline
 *   node scripts/typecheck-ratchet.mjs --update   # write the current count
 *
 * The end state is baseline 0, after which this should be replaced with a
 * plain `tsc --noEmit` in the build.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const baselineFile = join(repoRoot, "typecheck-baseline.json");
const update = process.argv.includes("--update");

function runTsc() {
  try {
    execFileSync(
      process.execPath,
      [join(repoRoot, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.app.json", "--noEmit"],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return "";
  } catch (e) {
    // tsc exits non-zero when there are errors; the diagnostics are on stdout.
    return `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
}

const output = runTsc();
const errorLines = output.split("\n").filter((l) => /error TS\d+/.test(l));
const count = errorLines.length;

// Group by file so the report points somewhere useful rather than just a number.
const byFile = new Map();
for (const line of errorLines) {
  const m = line.match(/^([^(]+)\(/);
  const file = m ? m[1] : "(unattributed)";
  byFile.set(file, (byFile.get(file) ?? 0) + 1);
}

if (update) {
  writeFileSync(baselineFile, `${JSON.stringify({ maxErrors: count }, null, 2)}\n`);
  console.log(`typecheck-ratchet: baseline written — ${count} errors`);
  process.exit(0);
}

if (!existsSync(baselineFile)) {
  console.error(
    `typecheck-ratchet: no ${baselineFile}. Create it with:\n` +
    `  node scripts/typecheck-ratchet.mjs --update`,
  );
  process.exit(1);
}

const { maxErrors } = JSON.parse(readFileSync(baselineFile, "utf8"));

if (count > maxErrors) {
  console.error(`typecheck-ratchet: FAIL — ${count} type errors, baseline allows ${maxErrors}.`);
  console.error(`This change introduced ${count - maxErrors} new type error(s).\n`);
  const top = [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  for (const [file, n] of top) console.error(`  ${String(n).padStart(4)}  ${file}`);
  console.error("\nFull output: npx tsc -p tsconfig.app.json --noEmit");
  process.exit(1);
}

if (count < maxErrors) {
  console.log(
    `typecheck-ratchet: PASS — ${count} type errors, down from ${maxErrors}. ` +
    `Lock the win in:\n  node scripts/typecheck-ratchet.mjs --update`,
  );
  process.exit(0);
}

console.log(`typecheck-ratchet: PASS — ${count} type errors, at baseline (${maxErrors}).`);
