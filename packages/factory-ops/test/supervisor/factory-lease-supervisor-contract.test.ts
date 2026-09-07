import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const supervisorLoopPath = "factories/mothership/scripts/factory_supervisor_loop.sh";

test("factory supervisor loop wires distributed lease acquire/heartbeat/release flow", () => {
  const script = readFileSync(supervisorLoopPath, "utf8");

  assert.match(script, /FACTORY_LEASE_ISSUE_NUMBER="\$\{FACTORY_LEASE_ISSUE_NUMBER:-\}"/);
  assert.match(script, /FACTORY_TRACKING_ISSUE_NUMBER="\$\{FACTORY_TRACKING_ISSUE_NUMBER:-\$\{FACTORY_LEASE_ISSUE_NUMBER:-407\}\}"/);
  assert.match(script, /factory_tracking_issue_number/);
  assert.match(script, /factory lease-acquire/);
  assert.match(script, /factory lease-heartbeat/);
  assert.match(script, /factory lease-release/);

  assert.match(script, /tick_skipped reason=lease_unavailable/);
  assert.match(script, /reason=lease_heartbeat_lost/);
  assert.match(script, /trap cleanup_supervisor_lease EXIT INT TERM/);
});
