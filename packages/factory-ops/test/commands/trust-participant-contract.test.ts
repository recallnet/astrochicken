import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  listActiveLocalIntentGraphPaths,
  listLocalIntentGraphPaths,
  migrateLocalIntentGraphTrustContracts,
  migrateTrustContractInDot,
  validateLocalIntentGraphTrustContracts,
  validateTrustContractInDot,
} from "../../src/commands/graph-trust-contract.ts";
import { loadGraphSemanticsText } from "@hatch/factory-core/graph-source-loader";

import { AGENT_IDS_V1, AGENT_ROLES_V1 } from "../../src/lib/trust-agent-identity-v1.ts";

const LEGACY_FIXTURE_INPUT = "packages/factory-ops/test/commands/fixtures/trust-participants/legacy-only.input.dot";
const LEGACY_FIXTURE_EXPECTED = "packages/factory-ops/test/commands/fixtures/trust-participants/legacy-only.expected.dot";
const STRICT_IDENTITY_MIXED_MISSING_FIXTURE = "packages/factory-ops/test/commands/fixtures/trust-participants/strict-identity-mixed-missing.dot";
const STRICT_IDENTITY_VALID_FIXTURE = "packages/factory-ops/test/commands/fixtures/trust-participants/strict-identity-valid.dot";
const STRICT_IDENTITY_INVALID_FIXTURE = "packages/factory-ops/test/commands/fixtures/trust-participants/strict-identity-invalid.dot";

test("trust identity allowlists are runtime-pinned with explicit source values", () => {
  assert.deepEqual(AGENT_IDS_V1, [
    "unknown",
    "tool.shell",
    "tool.python",
    "tool.http",
    "tool.generic",
    "stack.manager_loop",
    "agent.worktree",
    "agent.kw",
  ]);
  assert.deepEqual(AGENT_ROLES_V1, [
    "unknown",
    "tool.operator",
    "manager.supervisor",
    "worktree.implementer",
    "knowledge.researcher",
  ]);
});

test("trust-participant contract scans local graphs and defines explicit active graph boundary", () => {
  const localPaths = listLocalIntentGraphPaths();
  const activePaths = listActiveLocalIntentGraphPaths();

  assert.ok(localPaths.length > 0, "expected at least one local intent graph");
  assert.ok(activePaths.length > 0, "expected at least one active local intent graph");

  for (const path of localPaths) {
    assert.match(path, /^factories\/mothership\/workflows\/.+\.workflow-source\.mjs$/);
  }
  for (const path of activePaths) {
    if (path.startsWith("packages/capability-merge/")) continue;
    assert.ok(localPaths.includes(path), `${path} must be in local graph set`);
  }

  assert.equal(localPaths.some((path) => path.includes("factories/external/graphs")), false);
});

test("active intents graphs remain canonical trust-domain/role and migration is byte-stable no-op", () => {
  const paths = listActiveLocalIntentGraphPaths();

  for (const path of paths) {
    const original = loadGraphSemanticsText(path);

    const nonStrictOriginal = validateTrustContractInDot(original, { sourcePath: path, strict: false });
    assert.equal(nonStrictOriginal.ok, true);

    const migrated = migrateTrustContractInDot(original, { sourcePath: path });
    assert.equal(migrated.changed, false, `${path} should not require migration once canonical`);

    const remigrated = migrateTrustContractInDot(migrated.content, { sourcePath: path });
    assert.equal(remigrated.content, migrated.content, `${path} migration must be byte-stable on repeat`);

    const trustDomainMatches = migrated.content.match(/\btrust_domain\s*=/g) || [];
    const trustRoleMatches = migrated.content.match(/\btrust_role\s*=/g) || [];
    assert.equal(trustDomainMatches.length, trustRoleMatches.length, `${path} expected paired trust_domain/trust_role attrs`);

    assert.equal(/\btrust_participant\s*=/.test(migrated.content), false, `${path} should not contain legacy trust_participant`);
  }
});

test("strict trust contract enforcement is opt-in", () => {
  const dot = `digraph example {\n  start [shape=Mdiamond]\n  build [type=tool prompt=\":\"]\n  start -> build\n}`;

  const nonStrict = validateTrustContractInDot(dot, { sourcePath: "<inline>", strict: false });
  assert.equal(nonStrict.ok, true);
  assert.ok(nonStrict.violations.length > 0);

  const strict = validateTrustContractInDot(dot, { sourcePath: "<inline>", strict: true });
  assert.equal(strict.ok, false);
  assert.ok(strict.violations.length > 0);
  assert.equal(strict.violations.some((violation) => violation.code === "missing_agent_id"), true);
  assert.equal(strict.violations.some((violation) => violation.code === "missing_agent_role"), true);
});

test("legacy-only fixtures migrate deterministically to canonical trust attrs and remain strict-failing until explicit identity is set", () => {
  const legacyInput = readFileSync(LEGACY_FIXTURE_INPUT, "utf8");
  const expectedOutput = readFileSync(LEGACY_FIXTURE_EXPECTED, "utf8");

  const strictBefore = validateTrustContractInDot(legacyInput, { sourcePath: LEGACY_FIXTURE_INPUT, strict: true });
  assert.equal(strictBefore.ok, false);
  assert.ok(strictBefore.violations.some((violation) => violation.code === "legacy_trust_identity_forbidden"));

  const migrated = migrateTrustContractInDot(legacyInput, { sourcePath: LEGACY_FIXTURE_INPUT });
  assert.equal(migrated.changed, true);
  assert.equal(migrated.content, expectedOutput);

  const nonStrictAfter = validateTrustContractInDot(migrated.content, { sourcePath: LEGACY_FIXTURE_EXPECTED, strict: false });
  assert.equal(nonStrictAfter.ok, true);

  const strictAfter = validateTrustContractInDot(migrated.content, { sourcePath: LEGACY_FIXTURE_EXPECTED, strict: true });
  assert.equal(strictAfter.ok, false);
  assert.ok(strictAfter.violations.some((violation) => violation.code === "missing_agent_id"));
  assert.ok(strictAfter.violations.some((violation) => violation.code === "missing_agent_role"));

  const remigrated = migrateTrustContractInDot(migrated.content, { sourcePath: LEGACY_FIXTURE_EXPECTED });
  assert.equal(remigrated.content, migrated.content, "fixture migration should be byte-stable on rerun");
});

test("strict validation rejects malformed/mixed/conflicting trust schemas without regressing existing strict checks", () => {
  const dot = `digraph example {\n  n [type=tool trust_domain=\"EXAMPLE.LOCAL\" trust_role=\"example local\" trust_participant=\"mothership.local/mothership.local.codergen\" prompt=\":\" agent_id=\"tool.shell\" agent_role=\"tool.operator\"]\n}`;

  const strict = validateTrustContractInDot(dot, { sourcePath: "<inline>", strict: true });
  assert.equal(strict.ok, false);

  const codes = new Set(strict.violations.map((violation) => violation.code));
  assert.equal(codes.has("mixed_trust_identity_schema"), true);
  assert.equal(codes.has("malformed_trust_domain"), true);
  assert.equal(codes.has("malformed_trust_role"), true);
  assert.equal(codes.has("conflicting_legacy_trust_identity"), true);
  assert.equal(codes.has("legacy_trust_identity_forbidden"), true);
});

test("strict mixed-missing identity fixture fails deterministically with machine-actionable location metadata", () => {
  const dot = readFileSync(STRICT_IDENTITY_MIXED_MISSING_FIXTURE, "utf8");
  const strict = validateTrustContractInDot(dot, {
    sourcePath: `./${STRICT_IDENTITY_MIXED_MISSING_FIXTURE}`,
    strict: true,
  });
  assert.equal(strict.ok, false);

  const missingAgentId = strict.violations.filter((violation) => violation.code === "missing_agent_id");
  const missingAgentRole = strict.violations.filter((violation) => violation.code === "missing_agent_role");
  assert.equal(missingAgentId.length, 1);
  assert.equal(missingAgentRole.length, 2);

  const identityViolations = strict.violations.filter((violation) =>
    ["missing_agent_id", "missing_agent_role", "invalid_agent_id", "invalid_agent_role"].includes(violation.code),
  );
  assert.ok(identityViolations.length > 0);
  for (const violation of identityViolations) {
    assert.equal(violation.path, STRICT_IDENTITY_MIXED_MISSING_FIXTURE);
    assert.ok(violation.node_id);
    assert.equal(violation.node_location, `${STRICT_IDENTITY_MIXED_MISSING_FIXTURE}#${violation.node_id}`);
  }
});

test("strict valid explicit identity fixture passes", () => {
  const dot = readFileSync(STRICT_IDENTITY_VALID_FIXTURE, "utf8");
  const strict = validateTrustContractInDot(dot, { sourcePath: STRICT_IDENTITY_VALID_FIXTURE, strict: true });
  assert.equal(strict.ok, true, JSON.stringify(strict.violations, null, 2));
});

test("strict invalid identity values fixture fails with distinct invalid-code classification", () => {
  const dot = readFileSync(STRICT_IDENTITY_INVALID_FIXTURE, "utf8");
  const strict = validateTrustContractInDot(dot, { sourcePath: STRICT_IDENTITY_INVALID_FIXTURE, strict: true });
  assert.equal(strict.ok, false);

  const codes = new Set(strict.violations.map((violation) => violation.code));
  assert.equal(codes.has("invalid_agent_id"), true);
  assert.equal(codes.has("invalid_agent_role"), true);
});

test("strict recurring gate is scoped to dedicated fixtures (not legacy active-graph sweep)", () => {
  const activeNonStrictGate = validateLocalIntentGraphTrustContracts({ strict: false, activeOnly: true });
  assert.equal(activeNonStrictGate.ok, true, JSON.stringify(activeNonStrictGate.violations, null, 2));

  const migration = migrateLocalIntentGraphTrustContracts({ write: false, activeOnly: true });
  assert.equal(migration.changed_files, 0, "active graph migration should be idempotent no-op");

  const strictValidGate = validateLocalIntentGraphTrustContracts({
    strict: true,
    paths: [STRICT_IDENTITY_VALID_FIXTURE],
  });
  assert.equal(strictValidGate.ok, true, JSON.stringify(strictValidGate.violations, null, 2));

  const strictMissingGate = validateLocalIntentGraphTrustContracts({
    strict: true,
    paths: [STRICT_IDENTITY_MIXED_MISSING_FIXTURE],
  });
  assert.equal(strictMissingGate.ok, false, "expected strict missing-identity fixture failure");

  const cliOk = spawnSync("node", [
    "packages/factory-ops/src/cli.ts",
    "graph",
    "check-trust-participants",
    "--strict",
    "true",
    "--paths",
    STRICT_IDENTITY_VALID_FIXTURE,
  ], { encoding: "utf8" });
  assert.equal(cliOk.status, 0, cliOk.stderr || cliOk.stdout);

  const cliFail = spawnSync("node", [
    "packages/factory-ops/src/cli.ts",
    "graph",
    "check-trust-participants",
    "--strict",
    "true",
    "--paths",
    STRICT_IDENTITY_MIXED_MISSING_FIXTURE,
  ], { encoding: "utf8" });
  assert.equal(cliFail.status, 1, `expected strict CLI failure; stdout=${cliFail.stdout} stderr=${cliFail.stderr}`);
});
