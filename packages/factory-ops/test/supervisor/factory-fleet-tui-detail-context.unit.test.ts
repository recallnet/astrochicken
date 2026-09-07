import assert from "node:assert/strict";
import test from "node:test";

import { resolveFleetTuiDetailContext } from "../../src/cli/factory-command-helpers.ts";

test("resolveFleetTuiDetailContext re-resolves factory context instead of trusting stale runs_dir from fleet rows", async () => {
  const resolved = await resolveFleetTuiDetailContext({
    factory_id: "example-trading",
    target_repo: "example-org/example-trading",
    control_plane_repo: "recallnet/astrochicken",
    runs_dir: "/tmp/stale-example-trading-runs",
  });

  assert.equal(resolved.factory_id, "example-trading");
  assert.equal(resolved.target_repo, "example-org/example-trading");
  assert.notEqual(resolved.runs_dir, "/tmp/stale-example-trading-runs");
  assert.match(resolved.runs_dir, /\.hatch\/example-trading\/runs$/);
});

test("resolveFleetTuiDetailContext ignores non-loadable host runtime factory roots", async () => {
  const resolved = await resolveFleetTuiDetailContext({
    factory_id: "example-trading",
    target_repo: "example-org/example-trading",
    control_plane_repo: "recallnet/astrochicken",
    factory_root: `${process.env.HOME || "/tmp"}/.hatch-hosts/runtime/factories/example-trading`,
    factory_config_path: `${process.env.HOME || "/tmp"}/.hatch-hosts/runtime/factories/example-trading/factory.config.json`,
    runs_dir: "/tmp/stale-example-trading-runs",
  });

  assert.equal(resolved.factory_id, "example-trading");
  assert.equal(resolved.target_repo, "example-org/example-trading");
  assert.match(resolved.factory_root, /factories\/example-trading$/);
  assert.doesNotMatch(resolved.factory_root, /\.hatch-hosts\/runtime\/factories/);
  assert.match(resolved.runs_dir, /\.hatch\/example-trading\/runs$/);
});
