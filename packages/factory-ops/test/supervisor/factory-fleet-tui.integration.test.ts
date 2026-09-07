import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runExpectScenario } from "../helpers/tui-expect-harness.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const fixturePath = join(repoRoot, "packages/factory-ops/test/helpers/fleet-tui-pty-fixture.mjs");
const fastFirstPaintFixturePath = join(repoRoot, "packages/factory-ops/test/helpers/fleet-tui-fast-first-paint-fixture.mjs");

test("fleet TUI expect harness proves row movement, tab view switching, search, and in-app detail drill-in", () => {
  const run = runExpectScenario({
    cwd: repoRoot,
    command: [process.execPath, fixturePath],
    steps: [
      { expect: "*HATCH OPS*" },
      { expect: "*› alpha*" },
      { send: "j", afterMs: 100 },
      { expect: "*› beta*" },
      { expect: "*managed supervisor*" },
      { send: "\t", afterMs: 100 },
      { expect: "*1 visible*" },
      { expect: "*› alpha*" },
      { send: "/", afterMs: 100 },
      { expect: "*Search mode*" },
      { send: "alp", afterMs: 100 },
      { expect: "*search · alp*" },
      { send: "\r", afterMs: 100 },
      { expect: "*search · alp*" },
      { send: "\r", afterMs: 100 },
      { expect: "*Fleet / Now*" },
      { expect: "*alpha ship review*" },
      { expect: "*alpha ship review*" },
      { send: "\u001b", afterMs: 100 },
      { expect: "*Fleet control room*" },
      { send: "q", afterMs: 50 },
    ],
  });

  assert.match(run.transcript, /HATCH OPS/);
  assert.match(run.transcript, /managed supervisor/);
  assert.match(run.transcript, /search · alp/);
  assert.match(run.transcript, /Fleet \/ Now/);
  assert.match(run.transcript, /alpha ship review/);
});

test("fleet TUI stays responsive during blocking loadSnapshot refresh cycles", () => {
  const blockingFixturePath = join(repoRoot, "packages/factory-ops/test/helpers/fleet-tui-blocking-fixture.mjs");

  // The fixture uses a loadSnapshot that blocks for 800ms with busy-wait
  // (simulating spawnSync/readFileSync).  The refresh fires every 1.5s.
  // If the blocking runs on the main thread, the event loop is blocked
  // ~53% of the time, causing the nav debounce to drop most keystrokes.
  // We send j/k pairs at staggered intervals across multiple refresh
  // cycles to verify input is processed consistently.
  const run = runExpectScenario({
    cwd: repoRoot,
    command: [process.execPath, blockingFixturePath],
    timeoutSeconds: 15,
    steps: [
      { expect: "*HATCH OPS*" },
      { expect: "*alpha*" },
      // Wait long enough for multiple blocking refresh cycles to fire
      { send: "", afterMs: 2000 },
      { send: "j", afterMs: 200 },
      { expect: "*beta*" },
      { send: "k", afterMs: 200 },
      { expect: "*alpha*" },
      // Another round after more refresh cycles
      { send: "", afterMs: 2000 },
      { send: "j", afterMs: 200 },
      { expect: "*beta*" },
      { send: "q", afterMs: 100 },
    ],
  });

  assert.match(run.transcript, /HATCH OPS/);
  assert.match(run.transcript, /alpha/);
});

test("fleet TUI paints immediately from bootstrap snapshot before blocking fleet hydration completes", () => {
  const startedAt = Date.now();
  const run = runExpectScenario({
    cwd: repoRoot,
    command: [process.execPath, fastFirstPaintFixturePath],
    timeoutSeconds: 10,
    steps: [
      { expect: "*HATCH OPS*" },
      { expect: "*alpha*" },
      { expect: "*Hydrating fleet*" },
    ],
  });

  const elapsedMs = Date.now() - startedAt;
  assert.match(run.transcript, /HATCH OPS/);
  assert.match(run.transcript, /alpha/);
  assert.ok(elapsedMs < 1_500, `expected first paint under 1.5s, got ${elapsedMs}ms`);
});

test("fleet TUI expect harness proves detail enter opens a live session action", () => {
  const root = mkdtempSync(join(tmpdir(), "fleet-tui-expect-"));
  const actionPath = join(root, "action.json");

  runExpectScenario({
    cwd: repoRoot,
    env: {
      FLEET_TUI_ACTION_PATH: actionPath,
    },
    command: [process.execPath, fixturePath],
    steps: [
      { expect: "*HATCH OPS*" },
      { send: "\r", afterMs: 100 },
      { expect: "*Fleet / alpha*" },
      { send: "\r", afterMs: 100 },
    ],
  });

  const action = JSON.parse(readFileSync(actionPath, "utf8"));
  assert.equal(action.type, "session");
  assert.equal(action.factory_id, "alpha");
  assert.equal(action.run_id, "alpha-run-1");
});
