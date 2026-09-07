import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseControlPlaneBlocker,
  serializeControlPlaneBlocker,
  isControlPlaneBlocked,
  isControlPlaneResolved,
  describeUnblockCondition,
  extractBlockerRefIssueNumber,
  buildStructuredUnblockCondition,
  CONTROL_PLANE_BLOCKER_SCHEMA,
} from "../../src/lib/control-plane-blocker.ts";

describe("parseControlPlaneBlocker", () => {
  it("1 - empty/null metadata returns empty blocker", () => {
    const empty = { kind: "", blockerRef: "", unblockCondition: "", status: "", releaseId: "", releaseTag: "", releaseSha: "", manifestPath: "" };
    assert.deepStrictEqual(parseControlPlaneBlocker(null), empty);
    assert.deepStrictEqual(parseControlPlaneBlocker(undefined), empty);
    assert.deepStrictEqual(parseControlPlaneBlocker({}), empty);
  });

  it("2 - direct fields populate blocker", () => {
    const result = parseControlPlaneBlocker({ kind: "upstream_bug", blockerRef: "#123", status: "blocked" });
    assert.equal(result.kind, "upstream_bug");
    assert.equal(result.blockerRef, "#123");
    assert.equal(result.status, "blocked");
  });

  it("3 - snake_case aliases are normalized", () => {
    const result = parseControlPlaneBlocker({ blocker_kind: "upstream_bug", blocker_ref: "#123" });
    assert.equal(result.kind, "upstream_bug");
    assert.equal(result.blockerRef, "#123");
  });

  it("4 - label signal sets status=blocked", () => {
    const result = parseControlPlaneBlocker({ labels: [{ name: "blocked-control-plane" }] });
    assert.equal(result.status, "blocked");
  });

  it("5 - serialized in comment body is parsed", () => {
    const body = 'control_plane_blocker.v1:{"kind":"upstream_bug","status":"blocked"}';
    const result = parseControlPlaneBlocker({ comments: [{ body }] });
    assert.equal(result.kind, "upstream_bug");
    assert.equal(result.status, "blocked");
  });

  it("6 - default unblockCondition generated for upstream_bug with blockerRef", () => {
    const result = parseControlPlaneBlocker({ kind: "upstream_bug", blockerRef: "#99", status: "blocked" });
    assert.equal(result.unblockCondition, "Wait for upstream bug #99 to close.");
  });

  it("7 - default kind=upstream_bug when status=blocked and no kind", () => {
    const result = parseControlPlaneBlocker({ status: "blocked" });
    assert.equal(result.kind, "upstream_bug");
  });
});

describe("serializeControlPlaneBlocker", () => {
  it("8 - produces schema-prefixed JSON string", () => {
    const result = serializeControlPlaneBlocker({ kind: "upstream_bug", status: "blocked", blockerRef: "#1" });
    assert.ok(result.startsWith("control_plane_blocker.v1:"));
    const payload = JSON.parse(result.replace("control_plane_blocker.v1:", ""));
    assert.equal(payload.kind, "upstream_bug");
    assert.equal(payload.status, "blocked");
  });

  it("9 - empty blocker returns empty string", () => {
    assert.equal(serializeControlPlaneBlocker({}), "");
  });

  it("10 - includes release fields when present", () => {
    const result = serializeControlPlaneBlocker({ kind: "release_floor", status: "blocked", blockerRef: "#5", releaseId: "r1", releaseTag: "v1.0", releaseSha: "abc123" });
    const payload = JSON.parse(result.replace("control_plane_blocker.v1:", ""));
    assert.equal(payload.release_id, "r1");
    assert.equal(payload.release_tag, "v1.0");
    assert.equal(payload.release_sha, "abc123");
  });
});

describe("isControlPlaneBlocked", () => {
  it("11 - status=blocked returns true", () => {
    assert.equal(isControlPlaneBlocked({ status: "blocked" }), true);
  });

  it("12 - status=resumed returns false", () => {
    assert.equal(isControlPlaneBlocked({ status: "resumed" }), false);
  });

  it("13 - empty returns false", () => {
    assert.equal(isControlPlaneBlocked({}), false);
  });
});

describe("isControlPlaneResolved", () => {
  it("14 - status=resumed returns true", () => {
    assert.equal(isControlPlaneResolved({ status: "resumed" }), true);
  });

  it("15 - status=rejected returns true", () => {
    assert.equal(isControlPlaneResolved({ status: "rejected" }), true);
  });

  it("16 - status=superseded returns true", () => {
    assert.equal(isControlPlaneResolved({ status: "superseded" }), true);
  });

  it("17 - status=blocked returns false", () => {
    assert.equal(isControlPlaneResolved({ status: "blocked" }), false);
  });

  it("18 - empty returns false", () => {
    assert.equal(isControlPlaneResolved({}), false);
  });
});

describe("describeUnblockCondition", () => {
  it("19 - custom unblockCondition returned as-is", () => {
    assert.equal(
      describeUnblockCondition({ unblockCondition: "My custom condition", status: "blocked" }),
      "My custom condition",
    );
  });

  it("20 - status=rejected returns rejection text", () => {
    assert.equal(
      describeUnblockCondition({ status: "rejected" }),
      "Upstream rejected the requested control-plane change.",
    );
  });

  it("21 - status=superseded returns superseded text", () => {
    assert.equal(
      describeUnblockCondition({ status: "superseded" }),
      "Upstream superseded this blocker with a replacement path.",
    );
  });

  it("22 - status=resumed returns resolved text", () => {
    assert.equal(
      describeUnblockCondition({ status: "resumed" }),
      "Control-plane blocker resolved; dispatch may resume.",
    );
  });

  it("23 - no condition and no status returns empty string", () => {
    assert.equal(describeUnblockCondition({}), "");
  });
});

describe("extractBlockerRefIssueNumber", () => {
  it("24 - #123 returns 123", () => {
    assert.equal(extractBlockerRefIssueNumber({ blockerRef: "#123" }), "123");
  });

  it("25 - 123 returns 123", () => {
    assert.equal(extractBlockerRefIssueNumber({ blockerRef: "123" }), "123");
  });

  it("26 - empty string returns empty", () => {
    assert.equal(extractBlockerRefIssueNumber({ blockerRef: "" }), "");
  });

  it("27 - non-numeric returns empty", () => {
    assert.equal(extractBlockerRefIssueNumber({ blockerRef: "abc" }), "");
  });
});

describe("buildStructuredUnblockCondition", () => {
  it("28 - with kind and blockerRef returns structured object with human_text", () => {
    const result = buildStructuredUnblockCondition({ kind: "upstream_bug", blockerRef: "#42" });
    assert.equal(result.kind, "upstream_bug");
    assert.equal(result.blockerRef, "#42");
    assert.ok(result.human_text.length > 0);
    assert.equal(typeof result.required_release_floor, "string");
    assert.equal(result.linked_goal_number, 42);
  });

  it("29 - with linkedGoalNumber uses it as linked_goal_number", () => {
    const result = buildStructuredUnblockCondition({ kind: "upstream_bug", blockerRef: "#10", linkedGoalNumber: "99" });
    assert.equal(result.linked_goal_number, 99);
  });
});

describe("CONTROL_PLANE_BLOCKER_SCHEMA", () => {
  it("30 - equals control_plane_blocker.v1", () => {
    assert.equal(CONTROL_PLANE_BLOCKER_SCHEMA, "control_plane_blocker.v1");
  });
});
