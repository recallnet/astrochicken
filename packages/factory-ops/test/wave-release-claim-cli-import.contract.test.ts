// wave-release-claim-cli-import.contract.test.mjs
//
// Contract test: WaveReleaseClaimCommand must call the ops-layer release
// (releaseReadyWaveClaimOps) which updates the issue body marker claim,
// NOT the lease-layer release (releaseReadyWaveClaim) which only posts
// a comment. When the wrong function is called, the marker claim in
// the issue body stays "active" and blocks all new claim acquisitions
// until the lease expires.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cliSource = readFileSync(
  "packages/factory-ops/src/cli/commands/wave.ts",
  "utf8",
);

test("WaveReleaseClaimCommand with claim tokens must import releaseReadyWaveClaimOps (marker claim releaser)", () => {
  // The CLI has two branches in WaveReleaseClaimCommand.execute():
  //   1. When --claim-token/--claim-owner-id/--claim-run-id are provided:
  //      MUST use releaseReadyWaveClaimOps (updates issue body marker claim)
  //   2. When those are absent:
  //      Uses releaseReadyWaveClaim (posts lease event comment + optionally removes label)
  //
  // Bug: if branch 1 imports releaseReadyWaveClaim instead of releaseReadyWaveClaimOps,
  // the marker claim in the issue body is never set to "released", blocking all
  // future claim acquisitions until the 20-minute lease expires.

  // Extract the WaveReleaseClaimCommand class body
  const classStart = cliSource.indexOf("class WaveReleaseClaimCommand");
  assert.ok(classStart >= 0, "WaveReleaseClaimCommand must exist in CLI source");

  // Find the first branch (when claim tokens are provided)
  const executeStart = cliSource.indexOf("async execute()", classStart);
  assert.ok(executeStart >= 0, "execute() method must exist");

  // Find the import inside the claim-token branch (ct !== undefined || co !== undefined || cr !== undefined)
  const branchCondition = cliSource.indexOf("ct !== undefined", executeStart);
  assert.ok(branchCondition >= 0, "claim-token branch condition must exist");

  // The next import() after this condition is the one that matters
  const importAfterBranch = cliSource.indexOf('await import("../../commands/wave-claim.ts")', branchCondition);
  assert.ok(importAfterBranch >= 0, "dynamic import of wave-claim barrel must exist");

  // Extract the destructuring before the import
  const lineStart = cliSource.lastIndexOf("\n", importAfterBranch) + 1;
  const lineEnd = cliSource.indexOf("\n", importAfterBranch);
  const importLine = cliSource.substring(lineStart, lineEnd).trim();

  // MUST destructure releaseReadyWaveClaimOps from the barrel (the ops version
  // that calls releaseWaveMarkerClaim to update the issue body).
  // Must NOT destructure releaseReadyWaveClaim (the lease-only version that
  // only posts a comment) — even if the local alias is releaseReadyWaveClaimOps.
  //
  // Correct:   { releaseReadyWaveClaimOps }
  // Wrong:     { releaseReadyWaveClaim: releaseReadyWaveClaimOps }
  //
  // The pattern { releaseReadyWaveClaim: ... } imports the lease version
  // regardless of the local alias name.
  assert.doesNotMatch(
    importLine,
    /\breleaseReadyWaveClaim\s*:/,
    "claim-token branch must NOT rename releaseReadyWaveClaim to a local alias — " +
    "this imports the lease-only version that only posts a comment, leaving " +
    "the marker claim active in the issue body. Use { releaseReadyWaveClaimOps } instead. " +
    `Actual import line: ${importLine}`,
  );
});

test("barrel exports releaseReadyWaveClaimOps and releaseReadyWaveClaim as distinct functions", () => {
  // Sanity: the two functions must be different — the ops version calls
  // releaseWaveMarkerClaim (updates issue body), while the lease version
  // only posts a comment.
  const barrelSource = readFileSync(
    "packages/factory-ops/src/commands/wave-claim.ts",
    "utf8",
  );

  // Both exports must exist
  assert.match(barrelSource, /export function releaseReadyWaveClaimOps/);
  assert.match(barrelSource, /export function releaseReadyWaveClaim\b/);

  // They must delegate to different implementations
  assert.match(barrelSource, /releaseReadyWaveClaimOpsImpl/);
  assert.match(barrelSource, /releaseReadyWaveClaimImpl/);
});

test("releaseReadyWaveClaimOps calls claimReleaser (marker claim) — not just a comment", async () => {
  // Behavioral proof: the ops-layer release actually calls the injected
  // claimReleaser, which defaults to releaseWaveMarkerClaim.
  // This is the function that updates the issue body.
  const { releaseReadyWaveClaimOps } = await import(
    "../src/commands/wave-claim.ts"
  );

  const releaserCalls = [];
  const out = releaseReadyWaveClaimOps({
    repo: "o/r",
    readyIssueNumber: "800",
    claimToken: "tok-test",
    claimOwnerId: "worker-1",
    claimRunId: "run-1",
    reason: "terminal_no_merge",
    claimReleaser: (opts) => {
      releaserCalls.push(opts);
      return { ok: true, released: true, reason: "claim_released" };
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.released, true);
  assert.equal(releaserCalls.length, 1, "must call claimReleaser (marker claim updater)");
  assert.equal(releaserCalls[0].reason, "terminal_no_merge");
});
