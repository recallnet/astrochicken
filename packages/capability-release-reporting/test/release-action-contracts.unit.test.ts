import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  assertReleaseReportContextContract,
  assertReleaseNarrativeContract,
  assertReleaseSlackPayloadContract,
  normalizeReleaseDeliveryStatusContract,
} from "../src/release-action-contracts.ts";

interface ReportContext {
  repo: string;
  factory_id: string;
  generated_at: string;
  since_iso: string;
  goals: unknown[];
  issues: unknown[];
  prs: unknown[];
  metrics: Record<string, unknown>;
  diff_stats: Record<string, unknown>;
  timing: Record<string, unknown>;
  errors: unknown[];
  [key: string]: unknown;
}

function validReportContext(): ReportContext {
  return {
    repo: "owner/repo",
    factory_id: "f-1",
    generated_at: "2026-03-22T00:00:00Z",
    since_iso: "2026-03-21T00:00:00Z",
    goals: [],
    issues: [],
    prs: [],
    metrics: {},
    diff_stats: {},
    timing: {},
    errors: [],
  };
}

describe("assertReleaseReportContextContract", () => {
  it("returns value for a valid full object", () => {
    const v = validReportContext();
    assert.equal(assertReleaseReportContextContract(v), v);
  });

  it("throws for null", () => {
    assert.throws(() => assertReleaseReportContextContract(null), /must be an object/);
  });

  it("throws for undefined", () => {
    assert.throws(() => assertReleaseReportContextContract(undefined), /must be an object/);
  });

  it("throws for an array", () => {
    assert.throws(() => assertReleaseReportContextContract([]), /must be an object/);
  });

  it("throws when repo is missing", () => {
    const v = validReportContext();
    delete v.repo;
    assert.throws(() => assertReleaseReportContextContract(v), /repo is required/);
  });

  it("throws when repo is whitespace-only", () => {
    const v = validReportContext();
    v.repo = "   ";
    assert.throws(() => assertReleaseReportContextContract(v), /repo is required/);
  });

  it("throws when factory_id is missing", () => {
    const v = validReportContext();
    delete v.factory_id;
    assert.throws(() => assertReleaseReportContextContract(v), /factory_id is required/);
  });

  it("throws when generated_at is missing", () => {
    const v = validReportContext();
    delete v.generated_at;
    assert.throws(() => assertReleaseReportContextContract(v), /generated_at is required/);
  });

  it("throws when since_iso is missing", () => {
    const v = validReportContext();
    delete v.since_iso;
    assert.throws(() => assertReleaseReportContextContract(v), /since_iso is required/);
  });

  it("throws when goals is not an array", () => {
    const v: Record<string, unknown> = validReportContext();
    v.goals = "not-array";
    assert.throws(() => assertReleaseReportContextContract(v), /goals must be an array/);
  });

  it("throws when issues is not an array", () => {
    const v: Record<string, unknown> = validReportContext();
    v.issues = {};
    assert.throws(() => assertReleaseReportContextContract(v), /issues must be an array/);
  });

  it("throws when prs is not an array", () => {
    const v: Record<string, unknown> = validReportContext();
    v.prs = null;
    assert.throws(() => assertReleaseReportContextContract(v), /prs must be an array/);
  });

  it("throws when metrics is not an object", () => {
    const v: Record<string, unknown> = validReportContext();
    v.metrics = "string";
    assert.throws(() => assertReleaseReportContextContract(v), /metrics must be an object/);
  });

  it("throws when diff_stats is not an object", () => {
    const v: Record<string, unknown> = validReportContext();
    v.diff_stats = [];
    assert.throws(() => assertReleaseReportContextContract(v), /diff_stats must be an object/);
  });

  it("throws when timing is not an object", () => {
    const v: Record<string, unknown> = validReportContext();
    v.timing = null;
    assert.throws(() => assertReleaseReportContextContract(v), /timing must be an object/);
  });

  it("throws when errors is not an array", () => {
    const v: Record<string, unknown> = validReportContext();
    v.errors = {};
    assert.throws(() => assertReleaseReportContextContract(v), /errors must be an array/);
  });
});

describe("assertReleaseNarrativeContract", () => {
  it("returns value for a valid object", () => {
    const v = { delivery_decision: "deliver" };
    assert.equal(assertReleaseNarrativeContract(v), v);
  });

  it("throws for null", () => {
    assert.throws(() => assertReleaseNarrativeContract(null), /must be an object/);
  });

  it("throws when delivery_decision is missing", () => {
    assert.throws(() => assertReleaseNarrativeContract({}), /delivery_decision is required/);
  });

  it("throws when warnings is present but not an array", () => {
    assert.throws(
      () => assertReleaseNarrativeContract({ delivery_decision: "deliver", warnings: "nope" }),
      /warnings must be an array when present/,
    );
  });

  it("does not throw when warnings is absent", () => {
    assert.doesNotThrow(() => assertReleaseNarrativeContract({ delivery_decision: "deliver" }));
  });

  it("does not throw when warnings is an array", () => {
    assert.doesNotThrow(() => assertReleaseNarrativeContract({ delivery_decision: "deliver", warnings: ["w1"] }));
  });
});

describe("assertReleaseSlackPayloadContract", () => {
  it("returns value for a valid object with blocks array", () => {
    const v = { blocks: [{ type: "section" }] };
    assert.equal(assertReleaseSlackPayloadContract(v), v);
  });

  it("throws for null", () => {
    assert.throws(() => assertReleaseSlackPayloadContract(null), /must be an object/);
  });

  it("throws when blocks is not an array", () => {
    assert.throws(() => assertReleaseSlackPayloadContract({ blocks: "nope" }), /blocks must be an array/);
  });
});

describe("normalizeReleaseDeliveryStatusContract", () => {
  it("normalizes an object with status and issue_url", () => {
    assert.deepStrictEqual(
      normalizeReleaseDeliveryStatusContract({ status: " posted ", issue_url: " https://x " }),
      { status: "posted", issue_url: "https://x" },
    );
  });

  it("returns trimmed empty strings for object with empty fields", () => {
    assert.deepStrictEqual(
      normalizeReleaseDeliveryStatusContract({ status: "", issue_url: "" }),
      { status: "", issue_url: "" },
    );
  });

  it("wraps a string into status with empty issue_url", () => {
    assert.deepStrictEqual(
      normalizeReleaseDeliveryStatusContract("delivered"),
      { status: "delivered", issue_url: "" },
    );
  });

  it("returns empty strings for null", () => {
    assert.deepStrictEqual(
      normalizeReleaseDeliveryStatusContract(null),
      { status: "", issue_url: "" },
    );
  });

  it("returns empty strings for undefined", () => {
    assert.deepStrictEqual(
      normalizeReleaseDeliveryStatusContract(undefined),
      { status: "", issue_url: "" },
    );
  });
});
