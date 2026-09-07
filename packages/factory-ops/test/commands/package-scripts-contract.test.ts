import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("factory-ops test lifecycle builds factory-telemetry first", () => {
  const pkg = JSON.parse(readFileSync("packages/factory-ops/package.json", "utf8"));
  const pretest = pkg?.scripts?.pretest;

  assert.equal(typeof pretest, "string", "packages/factory-ops/package.json scripts.pretest must exist");
  assert.match(
    pretest,
    /pnpm --filter @recallnet\/factory-telemetry build/,
    "scripts.pretest must build @recallnet/factory-telemetry to satisfy dist exports before tests",
  );
});

test("factory-ops test scripts route through the canonical package manifest", () => {
  const pkg = JSON.parse(readFileSync("packages/factory-ops/package.json", "utf8"));
  assert.match(
    pkg?.scripts?.test || "",
    /run-package-test-manifest\.mjs .*--manifest config\/testing\/package-test-manifests\/packages-factory-ops\.json --suite default/,
  );
  assert.match(
    pkg?.scripts?.["test:wave-claim-gates"] || "",
    /run-package-test-manifest\.mjs .*--manifest config\/testing\/package-test-manifests\/packages-factory-ops\.json --suite wave-claim-gates/,
  );
});
