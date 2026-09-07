import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = join(__dirname, "..");
const TEST_DIR = __dirname;

const COVERAGE_CONTRACT = [
  { source: "src/commands/wave-block-ready.ts", fn: "blockReadyWaveIssue", minTests: 5 },

  { source: "src/commands/wave-create-ready.ts", fn: "createWaveReadyMarker", minTests: 2 },
  { source: "src/commands/wave-create-ready.ts", fn: "createReadyMarkers", minTests: 5 },
  { source: "src/commands/wave-create-ready.ts", fn: "createReadyMarkersFromRun", minTests: 0 },
  { source: "src/commands/wave-create-ready.ts", fn: "createReadyMarkersFromArgs", minTests: 0 },
  { source: "src/commands/wave-create-ready.ts", fn: "findPriorWaveMarkerNumber", minTests: 4 },

  // wave-dispatch-select.mjs
  { source: "src/commands/wave-dispatch-select.ts", fn: "findPriorWave", minTests: 3 },
  { source: "src/commands/wave-dispatch-select.ts", fn: "isPriorWaveComplete", minTests: 5 },
  { source: "src/commands/wave-dispatch-select.ts", fn: "computeSelectedWaves", minTests: 8 },
  { source: "src/commands/wave-dispatch-select.ts", fn: "fetchTerminallyReleasedMarkers", minTests: 3 },
  { source: "src/commands/wave-dispatch-select.ts", fn: "selectDispatchWaves", minTests: 0 },
  { source: "src/commands/wave-dispatch-select.ts", fn: "selectDispatchWavesFromRun", minTests: 0 },
  { source: "src/commands/wave-dispatch-select.ts", fn: "selectDispatchWavesFromArgs", minTests: 0 },

  { source: "src/commands/wave-active-run-guard.ts", fn: "collectActiveWaveMilestoneOwners", minTests: 0 },
  { source: "src/commands/wave-active-run-guard.ts", fn: "loadActiveWaveMilestoneOwners", minTests: 0 },
  { source: "src/commands/wave-active-run-guard.ts", fn: "mergeLocalActiveMilestones", minTests: 1 },

  { source: "src/commands/wave-sanitize-state.ts", fn: "collectActiveWaveLeases", minTests: 3 },
  { source: "src/commands/wave-sanitize-state.ts", fn: "readRunStatuses", minTests: 0 },
  { source: "src/commands/wave-sanitize-state.ts", fn: "readRunMetadata", minTests: 1 },
  { source: "src/commands/wave-sanitize-state.ts", fn: "downgradeOrphanedLeases", minTests: 5 },
  { source: "src/commands/wave-sanitize-state.ts", fn: "planStaleWorktreeCleanupActions", minTests: 1 },
  { source: "src/commands/wave-sanitize-state.ts", fn: "planWaveOrphanStateRepair", minTests: 8 },
  { source: "src/commands/wave-sanitize-state.ts", fn: "planWaveReadyNormalization", minTests: 2 },
  { source: "src/commands/wave-sanitize-state.ts", fn: "applyWaveOrphanStateRepair", minTests: 5 },
  { source: "src/commands/wave-sanitize-state.ts", fn: "requeueAfterJudgeFailure", minTests: 2 },
  { source: "src/commands/wave-sanitize-state.ts", fn: "sanitizeWaveState", minTests: 0 },

  { source: "src/commands/wave-claim.ts", fn: "milestoneTitleForWaveMarker", minTests: 1 },
  { source: "src/commands/wave-claim.ts", fn: "buildDeterministicClaimToken", minTests: 1 },
  { source: "src/commands/wave-claim.ts", fn: "normalizeWaveMarkerClaim", minTests: 1 },
  { source: "src/commands/wave-claim.ts", fn: "parseWaveMarkerClaimFromBody", minTests: 1 },
  { source: "src/commands/wave-claim.ts", fn: "upsertWaveMarkerClaimInBody", minTests: 1 },
  { source: "src/commands/wave-claim.ts", fn: "describeWaveMarkerClaim", minTests: 1 },
  { source: "src/commands/wave-claim.ts", fn: "parseWaveMarkerClaimSnapshot", minTests: 1 },
  { source: "src/commands/wave-claim.ts", fn: "createWaveClaimGhClient", minTests: 1 },
  { source: "src/commands/wave-claim.ts", fn: "acquireWaveMarkerClaim", minTests: 1 },
  { source: "src/commands/wave-claim.ts", fn: "validateWaveMarkerClaimOwnership", minTests: 1 },
  { source: "src/commands/wave-claim.ts", fn: "releaseWaveMarkerClaim", minTests: 1 },
  { source: "src/commands/wave-claim.ts", fn: "lockReadyWaveIssue", minTests: 1 },
  { source: "src/commands/wave-claim.ts", fn: "completeReadyWaveIssue", minTests: 1 },
  { source: "src/commands/wave-claim.ts", fn: "releaseReadyWaveClaimOps", minTests: 1 },
  { source: "src/commands/wave-claim.ts", fn: "parseWaveReadyLeaseEventsFromComment", minTests: 0 },
  { source: "src/commands/wave-claim.ts", fn: "buildWaveReadyLeaseEvent", minTests: 1 },
  { source: "src/commands/wave-claim.ts", fn: "renderWaveReadyLeaseComment", minTests: 1 },
  { source: "src/commands/wave-claim.ts", fn: "collectActiveWaveLeasesFromIssues", minTests: 1 },
  { source: "src/commands/wave-claim.ts", fn: "collectActiveWaveLeasesFromRepo", minTests: 1 },
  { source: "src/commands/wave-claim.ts", fn: "claimReadyWaveIssue", minTests: 1 },
  { source: "src/commands/wave-claim.ts", fn: "releaseReadyWaveClaim", minTests: 1 },

  { source: "src/lib/wave-claim-lifecycle.ts", fn: "listWaveClaimTransitionOwners", minTests: 1 },
  { source: "src/lib/wave-claim-lifecycle.ts", fn: "evaluateWaveClaimInvariants", minTests: 1 },
  { source: "src/lib/wave-claim-lifecycle.ts", fn: "decideWaveClaimAcquisition", minTests: 1 },
  { source: "src/lib/wave-claim-lifecycle.ts", fn: "decideWaveClaimRelease", minTests: 1 },
  { source: "src/lib/wave-claim-lifecycle.ts", fn: "nextRetryCircuitState", minTests: 1 },
  { source: "src/lib/wave-claim-lifecycle.ts", fn: "planWaveClaimOrphanSweep", minTests: 1 },
  { source: "src/lib/wave-claim-lifecycle.ts", fn: "applyWaveClaimOrphanSweep", minTests: 1 },
];

const WAVE_SOURCE_FILES = [
  "src/commands/wave-active-run-guard.ts",
  "src/commands/wave-block-ready.ts",
  "src/commands/wave-create-ready.ts",
  "src/commands/wave-dispatch-select.ts",
  "src/commands/wave-sanitize-state.ts",
  "src/commands/wave-claim.ts",
  "src/lib/wave-claim-lifecycle.ts",
];

function extractExportedFunctions(filePath) {
  const content = readFileSync(filePath, "utf8");
  const matches = content.matchAll(/^export\s+function\s+(\w+)/gm);
  return [...matches].map((m) => m[1]);
}

function countTestReferences(testDir, fnName) {
  let count = 0;
  const testFiles = [
    "wave-claim.test.mjs",
    "wave-claim-circuit-gate.test.mjs",
    "wave-claim-contention-gate.test.mjs",
    "wave-claim-diagnostics.test.mjs",
    "wave-claim-orphan-sweep-gate.test.mjs",
    "wave-claim-reclaim-gate.test.mjs",
    "wave-create-ready.test.mjs",
    "wave-dispatch-select.test.mjs",
    "wave-sanitize-state.test.mjs",
    "wave-block-ready.test.mjs",
    "wave-create-ready-blocked-by.contract.test.mjs",
  ];

  for (const file of testFiles) {
    const fullPath = join(testDir, file);
    if (!existsSync(fullPath)) continue;
    const content = readFileSync(fullPath, "utf8");
    const testBlocks = content.matchAll(/^test\("([^"]+)"/gm);
    for (const [, desc] of testBlocks) {
      if (desc.toLowerCase().includes(fnName.toLowerCase()) ||
          desc.toLowerCase().includes(fnName.replace(/([A-Z])/g, "_$1").toLowerCase())) {
        count += 1;
      }
    }
  }
  return count;
}

test("every wave source file export is declared in the coverage contract", () => {
  const contractFnsBySource = new Map();
  for (const entry of COVERAGE_CONTRACT) {
    if (!contractFnsBySource.has(entry.source)) contractFnsBySource.set(entry.source, new Set());
    contractFnsBySource.get(entry.source).add(entry.fn);
  }

  const missing = [];
  for (const sourceFile of WAVE_SOURCE_FILES) {
    const exports = extractExportedFunctions(join(WORKSPACE_ROOT, sourceFile));
    const declared = contractFnsBySource.get(sourceFile) || new Set();
    for (const fn of exports) {
      if (!declared.has(fn)) missing.push(`${sourceFile}:${fn}`);
    }
  }

  assert.equal(missing.length, 0,
    `Exports missing from coverage contract (add them + write tests):\n  ${missing.join("\n  ")}`);
});

test("coverage contract does not reference non-existent exports", () => {
  const stale = [];
  for (const entry of COVERAGE_CONTRACT) {
    const exports = extractExportedFunctions(join(WORKSPACE_ROOT, entry.source));
    if (!exports.includes(entry.fn)) stale.push(`${entry.source}:${entry.fn}`);
  }

  assert.equal(stale.length, 0,
    `Coverage contract references non-existent exports (remove them):\n  ${stale.join("\n  ")}`);
});

test("every function with minTests > 0 has at least that many tests", () => {
  const failures = [];
  for (const entry of COVERAGE_CONTRACT) {
    if (entry.minTests === 0) continue;
    const actual = countTestReferences(TEST_DIR, entry.fn);
    if (actual < entry.minTests) {
      failures.push(`${entry.source}:${entry.fn} — need ${entry.minTests} tests, found ${actual}`);
    }
  }

  assert.equal(failures.length, 0,
    `Functions below minimum test coverage:\n  ${failures.join("\n  ")}`);
});

test("coverage contract sentinel — update when adding new wave exports", () => {
  let totalExports = 0;
  for (const sourceFile of WAVE_SOURCE_FILES) {
    totalExports += extractExportedFunctions(join(WORKSPACE_ROOT, sourceFile)).length;
  }

  assert.equal(totalExports, 54,
    `Expected 54 wave lifecycle exports but found ${totalExports}. ` +
    "If you added a new export, add it to COVERAGE_CONTRACT in this file " +
    "with an appropriate minTests value, then update this sentinel count.");
});

test("every declared wave source file exists on disk", () => {
  const missing = WAVE_SOURCE_FILES.filter((file) => !existsSync(join(WORKSPACE_ROOT, file)));
  assert.equal(missing.length, 0,
    `Declared wave source files not found on disk:\n  ${missing.join("\n  ")}\n` +
    "If you renamed or removed a lifecycle file, update WAVE_SOURCE_FILES.");
});

test("total minimum test count is at least 77", () => {
  const totalMin = COVERAGE_CONTRACT.reduce((sum, entry) => sum + entry.minTests, 0);
  assert.ok(totalMin >= 77,
    `Total minimum test count is ${totalMin}, expected at least 77. ` +
    "If you removed tests, you must add replacements. Coverage cannot regress.");
});
