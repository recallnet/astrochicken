import test from "node:test";
import assert from "node:assert/strict";

import { checkSharedOwnershipEnforcement } from "./check-shared-ownership-enforcement.ts";

test("checkSharedOwnershipEnforcement passes when enforced files avoid low-level transport helpers", () => {
  const result = checkSharedOwnershipEnforcement({
    files: ["ok.mjs"],
    inspectFileFn() {
      return [];
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.schema, "shared_ownership_enforcement/v1");
  assert.deepEqual(result.violations, []);
});

test("checkSharedOwnershipEnforcement fails when enforced files call low-level transport helpers", () => {
  const result = checkSharedOwnershipEnforcement({
    files: ["bad.mjs"],
    inspectFileFn(path) {
      return [
        { path, rule: "resolve_transport_pair" },
        { path, rule: "parse_contract_value" },
      ];
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.violations, [
    { path: "bad.mjs", rule: "resolve_transport_pair" },
    { path: "bad.mjs", rule: "parse_contract_value" },
  ]);
});
