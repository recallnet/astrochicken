import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTROL_PLANE_BLOCKER_SCHEMA,
  buildStructuredUnblockCondition,
  describeUnblockCondition,
  isControlPlaneBlocked,
  isControlPlaneResolved,
  parseControlPlaneBlocker,
  serializeControlPlaneBlocker,
} from "../../src/lib/control-plane-blocker.ts";

test("serializeControlPlaneBlocker emits canonical schema payload", () => {
  const encoded = serializeControlPlaneBlocker({
    kind: "upstream_bug",
    blockerRef: "#1234",
    unblockCondition: "release v1.2.3 ships",
    status: "blocked",
  });

  assert.match(encoded, new RegExp(`^${CONTROL_PLANE_BLOCKER_SCHEMA}:`));
  const parsed = parseControlPlaneBlocker(encoded);
  assert.equal(parsed.kind, "upstream_bug");
  assert.equal(parsed.blockerRef, "#1234");
  assert.equal(parsed.unblockCondition, "release v1.2.3 ships");
  assert.equal(parsed.status, "blocked");
});

test("parseControlPlaneBlocker infers blocked status from label when metadata is sparse", () => {
  const parsed = parseControlPlaneBlocker({ labels: [{ name: "blocked-control-plane" }] });
  assert.equal(parsed.status, "blocked");
  assert.equal(parsed.kind, "upstream_bug");
  assert.match(parsed.unblockCondition, /control-plane blocker status to change/i);
});

test("parseControlPlaneBlocker honors resolved statuses from comments", () => {
  const metadata = serializeControlPlaneBlocker({
    kind: "release_floor",
    blockerRef: "v2.0.0",
    unblockCondition: "release floor v2.0.0 available",
    status: "superseded",
  });
  const parsed = parseControlPlaneBlocker({
    labels: [{ name: "blocked-control-plane" }],
    comments: [{ body: `note\n${metadata}` }],
  });

  assert.equal(parsed.status, "superseded");
  assert.equal(isControlPlaneBlocked(parsed), false);
  assert.equal(isControlPlaneResolved(parsed), true);
});

test("parseControlPlaneBlocker ignores incidental control-plane mentions in issue body text", () => {
  // Issue body describes a feature that deals with control-plane concepts —
  // the parser must not treat implementation spec text as blocker metadata.
  const parsed = parseControlPlaneBlocker({
    body: [
      "## Summary",
      "Goal #1488 needs one supported operator surface for fleet-wide visibility.",
      "The command reuses the existing per-factory status logic so the output stays",
      "outcome-first, resilient to missing metadata, and consistent with the registry",
      "schema already consumed by `hatch-ops factory status`.",
      "",
      "## Implementation Plan",
      "- Derive `health_state` enum (`healthy`, `blocked`, `upgrading`, `idle`, `unhealthy`)",
      "  with explicit rules: blocked if any rollout/blocker, unhealthy if context fails.",
      "- Include `control_plane_repo`, `blocked_reason`, and `health_status` fields.",
    ].join("\n"),
    labels: [{ name: "feature" }],
  });

  assert.equal(isControlPlaneBlocked(parsed), false, "feature spec text must not trigger blocker detection");
  assert.equal(parsed.status, "", "no blocker status from spec text");
});

test("parseControlPlaneBlocker detects structured schema prefix in body", () => {
  const serialized = serializeControlPlaneBlocker({
    kind: "upstream_bug",
    blockerRef: "#999",
    status: "blocked",
  });
  const parsed = parseControlPlaneBlocker({ body: `some context\n${serialized}` });
  assert.equal(isControlPlaneBlocked(parsed), true);
  assert.equal(parsed.blockerRef, "#999");
});

test("parseControlPlaneBlocker detects blocked-control-plane label", () => {
  const parsed = parseControlPlaneBlocker({
    body: "This issue implements fleet-status with control-plane visibility.",
    labels: [{ name: "blocked-control-plane" }],
  });
  assert.equal(isControlPlaneBlocked(parsed), true);
});

test("parseControlPlaneBlocker detects blocked_control_plane label", () => {
  const parsed = parseControlPlaneBlocker({
    body: "This issue implements fleet-status with control-plane visibility.",
    labels: [{ name: "blocked_control_plane" }],
  });
  assert.equal(isControlPlaneBlocked(parsed), true);
});

test("buildStructuredUnblockCondition returns deterministic structured fields", () => {
  const structured = buildStructuredUnblockCondition({
    kind: "release_floor",
    blockerRef: "#1234",
    requiredReleaseFloor: "v1.2.0",
  });
  assert.equal(structured.kind, "release_floor");
  assert.equal(structured.blockerRef, "#1234");
  assert.equal(structured.required_release_floor, "v1.2.0");
  assert.equal(structured.linked_goal_number, 1234);
  assert.match(structured.human_text, /v1\.2\.0|#1234/);
});

test("describeUnblockCondition returns deterministic fallback text", () => {
  assert.equal(
    describeUnblockCondition({ kind: "release_floor", blockerRef: "v9.9.9", status: "blocked" }),
    "Install or publish release floor v9.9.9.",
  );
});
