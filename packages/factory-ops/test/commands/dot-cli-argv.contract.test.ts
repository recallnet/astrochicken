/**
 * dot-cli-argv-contract.test.mjs
 *
 * Contract: every `<domain> run --op <action>` invocation in DOT graphs
 * must resolve to a registered clipanion command after normalizeArgv
 * transforms it to `<domain> <action>`.
 *
 * This test exists because a factory agent once removed normalizeArgv,
 * immediately breaking all DOT tool nodes that use the `run --op` form.
 * The test catches that class of mismatch at pre-commit time.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const GRAPHS_DIR = "factories/mothership/graphs";
const COMMANDS_DIR = "packages/factory-ops/src/cli/commands";
const CLI_INDEX = "packages/factory-ops/src/cli/index.ts";
const CLI_ENTRY = "packages/factory-ops/src/cli.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract all `domain run --op action` triples from DOT graph files. */
function extractRunOpPairs() {
  const dotFiles = readdirSync(GRAPHS_DIR).filter((f) => f.endsWith(".dot"));
  const pattern = /([a-z0-9_-]+)\s+run\s+--op\s+([a-z0-9_-]+)/g;
  const pairs = new Set();
  for (const file of dotFiles) {
    const src = readFileSync(join(GRAPHS_DIR, file), "utf8");
    for (const m of src.matchAll(pattern)) {
      pairs.add(`${m[1]} ${m[2]}`);
    }
  }
  return [...pairs].sort();
}

/** Extract all registered clipanion command paths from command source files. */
function extractRegisteredPaths() {
  const cmdFiles = readdirSync(COMMANDS_DIR).filter((f) => f.endsWith(".mjs") || f.endsWith(".ts"));
  // Match individual ["domain", "action"] pairs anywhere in static paths lines.
  // This handles multi-path entries like [["a","b"],["a","c"]] correctly.
  const paths = new Set();
  for (const file of cmdFiles) {
    const src = readFileSync(join(COMMANDS_DIR, file), "utf8");
    for (const line of src.split("\n")) {
      if (!line.includes("static paths")) continue;
      for (const seg of line.matchAll(/\["([^"]+)",\s*"([^"]+)"\]/g)) {
        paths.add(`${seg[1]} ${seg[2]}`);
      }
    }
  }
  return paths;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("normalizeArgv function is exported from cli/index.mjs", () => {
  const src = readFileSync(CLI_INDEX, "utf8");
  assert.match(src, /export function normalizeArgv/,
    "normalizeArgv must be exported — DOT graphs depend on the `run --op` form");
});

test("cli.mjs entrypoint uses normalizeArgv", () => {
  const src = readFileSync(CLI_ENTRY, "utf8");
  assert.match(src, /normalizeArgv/,
    "cli.mjs must call normalizeArgv to support DOT `run --op` form");
  assert.match(src, /normalizeArgv\(process\.argv\.slice\(2\)\)/,
    "cli.mjs must pass normalizeArgv(process.argv.slice(2)) to cli.runExit");
});

test("normalizeArgv correctly transforms run --op form", async () => {
  const { normalizeArgv } = await import("../../src/cli/index.ts");

  // run --op form → direct form
  assert.deepStrictEqual(
    normalizeArgv(["goal-issue", "run", "--op", "set-issue-context", "--issue-number", "42"]),
    ["goal-issue", "set-issue-context", "--issue-number", "42"],
  );

  assert.deepStrictEqual(
    normalizeArgv(["goal-run", "run", "--op", "split-results", "--fallback-b64", "abc"]),
    ["goal-run", "split-results", "--fallback-b64", "abc"],
  );

  // --operation alias
  assert.deepStrictEqual(
    normalizeArgv(["common", "run", "--operation", "resolve-default", "--value", "x"]),
    ["common", "resolve-default", "--value", "x"],
  );

  // direct form passes through unchanged
  assert.deepStrictEqual(
    normalizeArgv(["goal-run", "split-results", "--fallback-b64", "abc"]),
    ["goal-run", "split-results", "--fallback-b64", "abc"],
  );

  // no --op flag: leaves "run" in place
  assert.deepStrictEqual(
    normalizeArgv(["factory", "run"]),
    ["factory", "run"],
  );
});

test("every DOT `run --op` invocation maps to a registered clipanion command", () => {
  const dotPairs = extractRunOpPairs();
  const registered = extractRegisteredPaths();

  const missing = dotPairs.filter((p) => !registered.has(p));
  assert.deepStrictEqual(missing, [],
    `DOT graphs reference commands not registered in clipanion:\n  ${missing.join("\n  ")}\n\nEither add the missing command or fix the DOT graph invocation.`);
});
