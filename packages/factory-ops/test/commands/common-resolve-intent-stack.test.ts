import assert from "node:assert/strict";
import test from "node:test";

import { resolveIntentStack } from "../../src/commands/common-resolve-intent-stack.ts";

test("resolveIntentStack returns platform and factory intent for mothership", () => {
  const out = resolveIntentStack({
    factoryRoot: "factories/mothership",
    workIntent: "Review and decompose the current goal into real shipped increments.",
  });

  assert.match(out.platform_intent_path, /docs\/vision\.md$/);
  assert.match(out.factory_intent_path, /factories\/mothership\/INTENT\.md$/);
  assert.equal(out.factory_id, "mothership");
  assert.equal(out.target_repo, "recallnet/astrochicken");
  assert.deepEqual(out.destinations, {
    platform_incidents: {
      repo: "recallnet/astrochicken",
      labels: ["managed-factory-bug", "kind:mothership"],
    },
  });
  assert.equal(out.control_plane_repo, "recallnet/astrochicken");
  assert.match(out.platform_intent, /Vision: Software Factories on Hatch/i);
  assert.match(out.factory_intent, /control-plane factory/i);
  assert.match(out.work_intent, /Review and decompose/);
  assert.match(out.intent_stack_summary, /Factory identity:/);
  assert.doesNotMatch(out.intent_stack_summary, /target_repo=/);
});
