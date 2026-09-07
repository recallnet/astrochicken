import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const scriptsDirPath = join(repoRoot, "factories/example-web/scripts");
const pilotVerifierPath = join(repoRoot, "factories/example-web/scripts/verify-pilot-outcome.mjs");

// @context:regression !critical issue #2574 removes example-web-local pilot verifier ownership; reintroducing scripts must fail fast because managed runtime owns conformance verification now.
test("example-web no longer ships pilot verifier script or scripts directory", () => {
  assert.equal(existsSync(pilotVerifierPath), false, "factories/example-web/scripts/verify-pilot-outcome.mjs must not exist");
  assert.equal(existsSync(scriptsDirPath), false, "factories/example-web/scripts must not exist");
});
