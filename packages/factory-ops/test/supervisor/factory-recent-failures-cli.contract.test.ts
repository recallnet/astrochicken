import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("cli wires factory recent-failures command", () => {
  const cmd = readFileSync("packages/factory-ops/src/cli/commands/factory-status-cmds.ts", "utf8");
  assert.match(cmd, /static paths = \[\["factory", "recent-failures"\]\]/);
  assert.match(cmd, /listRecentFailures/);
});
