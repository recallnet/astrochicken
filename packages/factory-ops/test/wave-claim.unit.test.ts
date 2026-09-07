import test from "node:test";
import assert from "node:assert/strict";
import {
  WAVE_MARKER_CLAIM_SCHEMA_VERSION,
  WAVE_MARKER_CLAIM_BLOCK_START,
  WAVE_MARKER_CLAIM_BLOCK_END,
  WAVE_MARKER_CLAIM_TRANSITION_OWNERS,
  WAVE_READY_LEASE_EVENT_PREFIX,
  acquireWaveMarkerClaim,
  buildDeterministicClaimToken,
  buildWaveReadyLeaseEvent,
  claimReadyWaveIssue,
  collectActiveWaveLeasesFromIssues,
  collectActiveWaveLeasesFromRepo,
  completeReadyWaveIssue,
  createWaveClaimGhClient,
  describeWaveMarkerClaim,
  lockReadyWaveIssue,
  milestoneTitleForWaveMarker,
  normalizeWaveMarkerClaim,
  parseWaveMarkerClaimFromBody,
  parseWaveMarkerClaimSnapshot,
  parseWaveReadyLeaseEventsFromComment,
  releaseReadyWaveClaim,
  releaseReadyWaveClaimOps,
  releaseWaveMarkerClaim,
  renderWaveReadyLeaseComment,
  upsertWaveMarkerClaimInBody,
  validateWaveMarkerClaimOwnership,
} from "../src/commands/wave-claim.ts";
import {
  applyWaveClaimOrphanSweep,
  decideWaveClaimAcquisition,
  decideWaveClaimRelease,
  evaluateWaveClaimInvariants,
  listWaveClaimTransitionOwners,
  nextRetryCircuitState,
  planWaveClaimOrphanSweep,
} from "../src/lib/wave-claim-lifecycle.ts";

function issue({ number = 1, milestone = "goal-1-wave-1", body = "", state = "open", labels = ["ready"] } = {}) {
  return {
    number,
    title: `Wave Ready: ${milestone}`,
    milestone: { title: milestone },
    labels: (Array.isArray(labels) ? labels : []).map((name) => ({ name })),
    body,
    state,
  };
}

function createCasIssueClient(initialIssue) {
  const state = {
    etag: 1,
    issue: structuredClone(initialIssue),
  };

  return {
    getIssue() {
      return {
        ok: true,
        etag: `"${state.etag}"`,
        issue: structuredClone(state.issue),
      };
    },
    updateIssueBody({ body, etag }) {
      if (String(etag || "") && String(etag) !== `"${state.etag}"`) {
        return { ok: false, precondition_failed: true, error: "etag_mismatch" };
      }
      state.issue.body = String(body || "");
      state.etag += 1;
      return { ok: true };
    },
    snapshot() {
      return structuredClone(state.issue);
    },
  };
}

test("marker claim constants expose deterministic block boundaries and transition owner schema", () => {
  assert.equal(typeof WAVE_MARKER_CLAIM_BLOCK_START, "string");
  assert.equal(typeof WAVE_MARKER_CLAIM_BLOCK_END, "string");
  assert.equal(typeof WAVE_MARKER_CLAIM_TRANSITION_OWNERS, "object");
  assert.equal(Array.isArray(WAVE_MARKER_CLAIM_TRANSITION_OWNERS.transitions), true);
});

test("milestoneTitleForWaveMarker resolves milestone from object and title", () => {
  assert.equal(milestoneTitleForWaveMarker({ milestone: { title: "goal-1-wave-2" } }), "goal-1-wave-2");
  assert.equal(milestoneTitleForWaveMarker({ title: "Wave Ready: goal-1-wave-3" }), "goal-1-wave-3");
});

test("buildDeterministicClaimToken is stable for same input", () => {
  const a = buildDeterministicClaimToken({ ownerId: "o", runId: "r", issueNumber: 1, milestoneTitle: "goal-1-wave-1" });
  const b = buildDeterministicClaimToken({ ownerId: "o", runId: "r", issueNumber: 1, milestoneTitle: "goal-1-wave-1" });
  assert.equal(a, b);
});

test("normalizeWaveMarkerClaim normalizes claim payload", () => {
  const normalized = normalizeWaveMarkerClaim({
    schema_version: WAVE_MARKER_CLAIM_SCHEMA_VERSION,
    status: "active",
    claim_token: "wave_claim_1",
    owner_id: "worker-a",
    run_id: "run-a",
    ready_issue_number: "11",
    milestone_title: "goal-1-wave-1",
    lease_started_at: "2026-01-01T00:00:00.000Z",
    lease_expires_at: "2026-01-01T00:10:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(normalized.claim_token, "wave_claim_1");
  assert.equal(normalized.owner_id, "worker-a");
});

test("parseWaveMarkerClaimFromBody and upsertWaveMarkerClaimInBody round-trip claim blocks", () => {
  const claim = {
    schema_version: WAVE_MARKER_CLAIM_SCHEMA_VERSION,
    status: "active",
    claim_id: "wave_claim_1",
    claim_token: "wave_claim_1",
    owner_id: "worker-a",
    run_id: "run-a",
    ready_issue_number: "11",
    milestone_title: "goal-1-wave-1",
    lease_started_at: "2026-01-01T00:00:00.000Z",
    lease_expires_at: "2026-01-01T00:10:00.000Z",
    heartbeat_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    reclaim_count: 0,
  };
  const body = upsertWaveMarkerClaimInBody("Wave marker", claim);
  const parsed = parseWaveMarkerClaimFromBody(body, null);
  assert.equal(parsed.claim_token, "wave_claim_1");
});

test("describeWaveMarkerClaim and parseWaveMarkerClaimSnapshot classify active claim state", () => {
  const claim = {
    schema_version: WAVE_MARKER_CLAIM_SCHEMA_VERSION,
    status: "active",
    claim_id: "wave_claim_1",
    claim_token: "wave_claim_1",
    owner_id: "worker-a",
    run_id: "run-a",
    ready_issue_number: "11",
    milestone_title: "goal-1-wave-1",
    lease_started_at: "2026-01-01T00:00:00.000Z",
    lease_expires_at: "2099-01-01T00:10:00.000Z",
    heartbeat_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    reclaim_count: 0,
  };
  const described = describeWaveMarkerClaim(claim, { nowEpochMs: Date.parse("2026-01-01T00:01:00.000Z") });
  assert.equal(described.active, true);

  const snapshot = parseWaveMarkerClaimSnapshot({
    number: 11,
    title: "Wave Ready: goal-1-wave-1",
    body: upsertWaveMarkerClaimInBody("", claim),
  }, { nowEpochMs: Date.parse("2026-01-01T00:01:00.000Z") });
  assert.equal(snapshot.active, true);
});

test("createWaveClaimGhClient exposes deterministic client methods", () => {
  const client = createWaveClaimGhClient({ spawn: () => ({ status: 1, stdout: "", stderr: "boom" }) });
  assert.equal(typeof client.getIssue, "function");
  assert.equal(typeof client.updateIssueBody, "function");
});

test("acquireWaveMarkerClaim acquires ownership and validateWaveMarkerClaimOwnership validates it", () => {
  const client = createCasIssueClient(issue({ number: 700 }));
  const claimToken = buildDeterministicClaimToken({ ownerId: "worker-a", runId: "run-a", issueNumber: 700, milestoneTitle: "goal-205-wave-2" });

  const acquired = acquireWaveMarkerClaim({
    repo: "recallnet/astrochicken",
    issueNumber: 700,
    milestoneTitle: "goal-205-wave-2",
    ownerId: "worker-a",
    runId: "run-a",
    claimToken,
    leaseSeconds: 1200,
    nowEpochMs: Date.parse("2026-01-01T00:00:00.000Z"),
    client,
  });

  assert.equal(acquired.ok, true);
  assert.equal(acquired.acquired, true);

  const validated = validateWaveMarkerClaimOwnership({
    repo: "recallnet/astrochicken",
    issueNumber: 700,
    ownerId: "worker-a",
    runId: "run-a",
    claimToken,
    nowEpochMs: Date.parse("2026-01-01T00:00:10.000Z"),
    client,
  });
  assert.equal(validated.valid, true);
});

test("releaseWaveMarkerClaim releases claim and clears marker block", () => {
  const client = createCasIssueClient(issue({ number: 701 }));
  const claimToken = buildDeterministicClaimToken({ ownerId: "worker-a", runId: "run-a", issueNumber: 701, milestoneTitle: "goal-205-wave-2" });

  acquireWaveMarkerClaim({
    repo: "recallnet/astrochicken",
    issueNumber: 701,
    milestoneTitle: "goal-205-wave-2",
    ownerId: "worker-a",
    runId: "run-a",
    claimToken,
    leaseSeconds: 1200,
    nowEpochMs: Date.parse("2026-01-01T00:00:00.000Z"),
    client,
  });

  const released = releaseWaveMarkerClaim({
    repo: "recallnet/astrochicken",
    issueNumber: 701,
    ownerId: "worker-a",
    runId: "run-a",
    claimToken,
    reason: "wave_completed",
    nowEpochMs: Date.parse("2026-01-01T00:05:00.000Z"),
    client,
  });

  assert.equal(released.ok, true);
  assert.equal(released.released, true);
  assert.equal(parseWaveMarkerClaimFromBody(client.snapshot().body, null), null);
});

test("lockReadyWaveIssue grants lock after claim and releaseReadyWaveClaimOps passes through release", () => {
  const out = lockReadyWaveIssue({
    repo: "recallnet/astrochicken",
    readyIssueNumber: "702",
    milestoneTitle: "goal-205-wave-2",
    claimToken: "wave_claim_702",
    claimOwnerId: "worker-a",
    claimRunId: "run-a",
    claimAcquire: () => ({
      ok: true,
      acquired: true,
      claim: { claim_token: "wave_claim_702", lease_expires_at: "2099-01-01T00:00:00.000Z" },
      reason: "claim_acquired",
    }),
    execGh: () => ({ ok: true }),
  });

  assert.equal(out.lock_granted, "true");

  const released = releaseReadyWaveClaimOps({
    repo: "recallnet/astrochicken",
    readyIssueNumber: "702",
    claimToken: "wave_claim_702",
    claimOwnerId: "worker-a",
    claimRunId: "run-a",
    claimReleaser: () => ({ ok: true, released: true, reason: "claim_released" }),
  });
  assert.equal(released.released, true);
});

test("completeReadyWaveIssue closes marker and comments when ownership is valid", () => {
  const calls = [];
  const out = completeReadyWaveIssue({
    repo: "recallnet/astrochicken",
    readyIssueNumber: "703",
    milestoneTitle: "goal-205-wave-2",
    claimToken: "wave_claim_703",
    claimOwnerId: "worker-a",
    claimRunId: "run-a",
    claimValidator: () => ({ ok: true, valid: true, reason: "claim_valid" }),
    claimReleaser: () => ({ ok: true, released: true, reason: "claim_released" }),
    execGh: (args) => {
      calls.push(args);
      return { ok: true };
    },
  });

  assert.equal(out.completed, true);
  assert.equal(calls.some((args) => args[1] === "close"), true);
});

test("buildWaveReadyLeaseEvent and renderWaveReadyLeaseComment emit parseable lease payload", () => {
  const event = buildWaveReadyLeaseEvent({
    action: "claim",
    milestoneTitle: "goal-205-wave-2",
    readyIssueNumber: "800",
    runId: "run-800",
    pipeline: "wave_execute",
  });

  const body = renderWaveReadyLeaseComment(event);
  assert.equal(body.startsWith(WAVE_READY_LEASE_EVENT_PREFIX), true);

  const parsed = parseWaveReadyLeaseEventsFromComment({ body }, {
    fallbackMilestone: "goal-205-wave-2",
    fallbackIssueNumber: "800",
  });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].action, "claim");
});

test("claimReadyWaveIssue writes label+comment and releaseReadyWaveClaim writes release comment", () => {
  const calls = [];
  const execGh = (args) => {
    calls.push(args);
    return { ok: true, stdout: "", stderr: "" };
  };

  const claim = claimReadyWaveIssue({
    repo: "recallnet/astrochicken",
    readyIssueNumber: 801,
    milestoneTitle: "goal-205-wave-2",
    runId: "run-801",
    pipeline: "wave_execute",
    execGh,
  });
  assert.equal(claim.ok, true);

  const release = releaseReadyWaveClaim({
    repo: "recallnet/astrochicken",
    readyIssueNumber: 801,
    milestoneTitle: "goal-205-wave-2",
    runId: "run-801",
    pipeline: "wave_execute",
    reason: "completed",
    removeLabel: true,
    execGh,
  });
  assert.equal(release.ok, true);
  assert.equal(calls.length >= 4, true);
});

test("collectActiveWaveLeasesFromIssues and collectActiveWaveLeasesFromRepo resolve active leases", () => {
  const openIssues = [
    {
      number: 802,
      title: "Wave Ready: goal-205-wave-2",
      labels: [{ name: "wave-in-progress" }],
      milestone: { title: "goal-205-wave-2" },
      state: "OPEN",
    },
  ];

  const claimEvent = renderWaveReadyLeaseComment(buildWaveReadyLeaseEvent({
    action: "claim",
    milestoneTitle: "goal-205-wave-2",
    readyIssueNumber: 802,
    runId: "run-802",
    at: "2026-01-01T00:00:00.000Z",
  }));

  const fromIssues = collectActiveWaveLeasesFromIssues({
    openIssues,
    commentsByIssue: new Map([["802", [{ created_at: "2026-01-01T00:00:01.000Z", body: claimEvent }]]]),
  });
  assert.equal(fromIssues.active_lease_count, 1);

  const fromRepo = collectActiveWaveLeasesFromRepo({
    repo: "recallnet/astrochicken",
    openIssues,
    execGhJson: () => [{ created_at: "2026-01-01T00:00:01.000Z", body: claimEvent }],
  });
  assert.equal(fromRepo.active_lease_count, 1);
});

test("listWaveClaimTransitionOwners returns deterministic transition contract", () => {
  const owners = listWaveClaimTransitionOwners();
  assert.equal(Array.isArray(owners.transitions), true);
  assert.equal(owners.transitions.length > 0, true);
});

test("evaluateWaveClaimInvariants reports violations for malformed claims", () => {
  const out = evaluateWaveClaimInvariants({
    claim_token: "",
    owner_id: "",
    run_id: "",
    ready_issue_number: "",
    milestone_title: "",
    lease_started_at: "bad",
    lease_expires_at: "bad",
  });
  assert.equal(out.ok, false);
  assert.equal(out.violations.includes("claim_token_missing"), true);
});

test("decideWaveClaimAcquisition denies active foreign claim and permits own acquisition", () => {
  const denied = decideWaveClaimAcquisition({
    snapshot: { active: true, stale: false, claim: { owner_id: "worker-a", run_id: "run-a", claim_token: "x" } },
    issueNumber: "900",
    milestoneTitle: "goal-205-wave-2",
    ownerId: "worker-b",
    runId: "run-b",
    claimToken: "y",
  });
  assert.equal(denied.allowed, false);

  const granted = decideWaveClaimAcquisition({
    snapshot: { active: false, stale: false, claim: null },
    issueNumber: "900",
    milestoneTitle: "goal-205-wave-2",
    ownerId: "worker-a",
    runId: "run-a",
    claimToken: "wave_claim_900",
  });
  assert.equal(granted.allowed, true);
});

test("decideWaveClaimRelease enforces owner/token and supports force release", () => {
  const snapshot = {
    claim: {
      status: "active",
      claim_token: "wave_claim_901",
      owner_id: "worker-a",
      run_id: "run-a",
      ready_issue_number: "901",
      milestone_title: "goal-205-wave-2",
      lease_started_at: "2026-01-01T00:00:00.000Z",
      lease_expires_at: "2099-01-01T00:00:00.000Z",
      heartbeat_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  };

  const denied = decideWaveClaimRelease({ snapshot, ownerId: "worker-b", runId: "run-b", claimToken: "wave_claim_901" });
  assert.equal(denied.allowed, false);

  const forced = decideWaveClaimRelease({ snapshot, force: true, reason: "stale_wave_claim_expired" });
  assert.equal(forced.allowed, true);
  assert.equal(forced.released, true);
});

test("nextRetryCircuitState applies bounded retries with exponential backoff", () => {
  let state = { attempt_count: 0, overflow_count: 0, circuit_state: "closed", next_attempt_at: 0 };
  const now = Date.parse("2026-01-01T01:00:00.000Z");

  state = nextRetryCircuitState({ state, nowEpochMs: now, maxAttempts: 2, baseBackoffMs: 1000, capBackoffMs: 8000, terminalOverflowCount: 3 });
  state = nextRetryCircuitState({ state, nowEpochMs: now + 1, maxAttempts: 2, baseBackoffMs: 1000, capBackoffMs: 8000, terminalOverflowCount: 3 });
  state = nextRetryCircuitState({ state, nowEpochMs: now + 2, maxAttempts: 2, baseBackoffMs: 1000, capBackoffMs: 8000, terminalOverflowCount: 3 });
  assert.equal(state.decision, "open");
  assert.equal(state.backoff_ms, 1000);
});

test("planWaveClaimOrphanSweep identifies stale claim and stale worktree lock", () => {
  const plan = planWaveClaimOrphanSweep({
    claimSnapshots: [{ issue_number: "999", claim_token: "wave_claim_999", status: "active", milestone_title: "goal-205-wave-2", run_id: "run-dead", lease_expires_at: "2026-01-01T00:00:00.000Z" }],
    worktreeLocks: [{ lock_path: "/tmp/wave-lock-999", milestone_title: "goal-205-wave-2", run_id: "run-dead" }],
    activeRunIds: ["run-live"],
    nowEpochMs: Date.parse("2026-01-01T01:00:00.000Z"),
  });
  assert.equal(plan.action_count, 2);
});

test("applyWaveClaimOrphanSweep applies release and lock cleanup actions", () => {
  const plan = {
    actions: [
      { type: "release_claim", issue_number: "999", claim_token: "wave_claim_999", reason: "stale_claim_artifact" },
      { type: "cleanup_worktree_lock", lock_path: "/tmp/wave-lock-999", reason: "stale_worktree_lock_residue" },
    ],
  };

  const out = applyWaveClaimOrphanSweep({
    plan,
    releaseClaim: () => ({ ok: true }),
    removeWorktreeLock: () => ({ ok: true }),
  });

  assert.equal(out.ok, true);
  assert.equal(out.applied_count, 2);
});
