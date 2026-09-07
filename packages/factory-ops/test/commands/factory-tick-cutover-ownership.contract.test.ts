import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const REPO_ROOT = process.cwd();
const TICK_COMMAND_PATH = "packages/factory-ops/src/commands/factory-tick-status.ts";
const SUBSCRIBE_COMMAND_PATH = "packages/factory-ops/src/commands/factory-subscribe.ts";
const LEGACY_TICK_PATH = "factory-state-tick-projection.mjs";

test("factory tick-status routes through the canonical Postgres-backed owner", () => {
  const source = readFileSync(join(REPO_ROOT, TICK_COMMAND_PATH), "utf8");
  assert.equal(existsSync(join(REPO_ROOT, "packages/factory-ops/src/lib/factory-state-tick-projection.mjs")), false);
  assert.doesNotMatch(source, new RegExp(LEGACY_TICK_PATH.replace(".", "\\.")));
  assert.match(source, /factoryTickStatus as readCanonicalFactoryTickStatus/);
  assert.match(source, /readCanonicalFactoryTickStatus\(\{ runsDir, context, now \}\)/);
});

test("factory subscribe snapshot resolves current state through tick-status instead of the legacy tick reader", () => {
  const source = readFileSync(join(REPO_ROOT, SUBSCRIBE_COMMAND_PATH), "utf8");
  assert.doesNotMatch(source, new RegExp(LEGACY_TICK_PATH.replace(".", "\\.")));
  assert.match(source, /tickStatusFn = tickStatus/);
  assert.match(source, /tickStatusFn\(\{ runsDir, context, now \}\)/);
});
