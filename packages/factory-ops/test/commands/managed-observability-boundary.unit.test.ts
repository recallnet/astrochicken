import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  sanitizeMirroredPayload,
  assertPayloadWithinBoundary,
  ALLOWED_MIRRORED_KEYS,
  FORBIDDEN_HOST_LOCAL_KEYS,
  MANAGED_OBSERVABILITY_BOUNDARY_ERROR_CODE,
} from "../../src/lib/managed-observability-boundary.ts";

describe("sanitizeMirroredPayload", () => {
  it("preserves allowed top-level key", () => {
    const { sanitizedPayload, droppedKeys } = sanitizeMirroredPayload({
      factory_id: "x",
    });
    assert.equal(sanitizedPayload.factory_id, "x");
    assert.equal(droppedKeys.length, 0);
  });

  it("strips disallowed top-level key", () => {
    const { sanitizedPayload, droppedKeys } = sanitizeMirroredPayload({
      secret_data: "x",
    });
    assert.equal(sanitizedPayload.secret_data, undefined);
    assert.ok(droppedKeys.includes("secret_data"));
  });

  it("preserves nested allowed key", () => {
    const { sanitizedPayload } = sanitizeMirroredPayload({
      lifecycle: { state: "active" },
    });
    assert.equal(sanitizedPayload.lifecycle.state, "active");
  });

  it("strips nested disallowed key while keeping allowed siblings", () => {
    const { sanitizedPayload, droppedKeys } = sanitizeMirroredPayload({
      lifecycle: { state: "active", secret: "x" },
    });
    assert.equal(sanitizedPayload.lifecycle.state, "active");
    assert.equal(sanitizedPayload.lifecycle.secret, undefined);
    assert.ok(droppedKeys.includes("lifecycle.secret"));
  });

  it("strips forbidden key even if path could match allowed prefix", () => {
    const { sanitizedPayload, droppedKeys } = sanitizeMirroredPayload({
      domain_result: { something: "value" },
    });
    assert.equal(sanitizedPayload.domain_result, undefined);
    assert.ok(droppedKeys.includes("domain_result"));
  });

  it("preserves array with allowed path", () => {
    const { sanitizedPayload } = sanitizeMirroredPayload({
      managed_snapshot: {
        latest_incidents: [
          { incident_fingerprint: "x", severity: "high" },
        ],
      },
    });
    assert.equal(sanitizedPayload.managed_snapshot.latest_incidents.length, 1);
    assert.equal(
      sanitizedPayload.managed_snapshot.latest_incidents[0].incident_fingerprint,
      "x",
    );
    assert.equal(
      sanitizedPayload.managed_snapshot.latest_incidents[0].severity,
      "high",
    );
  });

  it("droppedKeys lists all stripped paths sorted and deduplicated", () => {
    const { droppedKeys } = sanitizeMirroredPayload({
      zzz_secret: "a",
      aaa_secret: "b",
      aaa_secret2: "c",
    });
    assert.deepEqual(droppedKeys, ["aaa_secret", "aaa_secret2", "zzz_secret"]);
  });

  it("returns empty object for null payload", () => {
    const { sanitizedPayload, droppedKeys } = sanitizeMirroredPayload(null);
    assert.deepEqual(sanitizedPayload, {});
    assert.equal(droppedKeys.length, 0);
  });

  it("returns empty object for undefined payload", () => {
    const { sanitizedPayload } = sanitizeMirroredPayload(undefined);
    assert.deepEqual(sanitizedPayload, {});
  });

  it("respects custom allowedKeys override", () => {
    const customAllowed = new Set(["custom_field"]);
    const { sanitizedPayload, droppedKeys } = sanitizeMirroredPayload(
      { custom_field: "yes", factory_id: "x" },
      { allowedKeys: customAllowed },
    );
    assert.equal(sanitizedPayload.custom_field, "yes");
    assert.equal(sanitizedPayload.factory_id, undefined);
    assert.ok(droppedKeys.includes("factory_id"));
  });
});

describe("assertPayloadWithinBoundary", () => {
  it("returns ok for valid payload with only allowed keys", () => {
    const result = assertPayloadWithinBoundary({
      factory_id: "x",
      lifecycle: { state: "active" },
    });
    assert.deepEqual(result, { ok: true, code: "ok", violations: [] });
  });

  it("throws for non-object payload", () => {
    try {
      assertPayloadWithinBoundary("string");
      assert.fail("expected to throw");
    } catch (err) {
      assert.equal(err.code, MANAGED_OBSERVABILITY_BOUNDARY_ERROR_CODE);
      assert.ok(err.violations.some((v) => v.includes("non_object")));
    }
  });

  it("throws for null payload", () => {
    try {
      assertPayloadWithinBoundary(null);
      assert.fail("expected to throw");
    } catch (err) {
      assert.equal(err.code, MANAGED_OBSERVABILITY_BOUNDARY_ERROR_CODE);
    }
  });

  it("throws with disallowed_key violation for unknown key", () => {
    try {
      assertPayloadWithinBoundary({ secret_data: "x" });
      assert.fail("expected to throw");
    } catch (err) {
      assert.equal(err.code, MANAGED_OBSERVABILITY_BOUNDARY_ERROR_CODE);
      assert.ok(
        err.violations.some(
          (v) => v.includes("disallowed_key") && v.includes("secret_data"),
        ),
      );
    }
  });

  it("throws with forbidden_key violation for forbidden key", () => {
    try {
      assertPayloadWithinBoundary({ domain_result: {} });
      assert.fail("expected to throw");
    } catch (err) {
      assert.equal(err.code, MANAGED_OBSERVABILITY_BOUNDARY_ERROR_CODE);
      assert.ok(
        err.violations.some(
          (v) => v.includes("forbidden_key") && v.includes("domain_result"),
        ),
      );
    }
  });

  it("collects multiple violations sorted and deduplicated", () => {
    try {
      assertPayloadWithinBoundary({
        zzz_bad: "a",
        aaa_bad: "b",
        domain_result: {},
      });
      assert.fail("expected to throw");
    } catch (err) {
      assert.ok(err.violations.length >= 3);
      // Verify sorted
      for (let i = 1; i < err.violations.length; i++) {
        assert.ok(err.violations[i - 1].localeCompare(err.violations[i]) <= 0);
      }
    }
  });

  it("flags nested forbidden key telemetry.event_name", () => {
    try {
      assertPayloadWithinBoundary({
        telemetry: { event_name: "secret_event" },
      });
      assert.fail("expected to throw");
    } catch (err) {
      assert.ok(
        err.violations.some(
          (v) =>
            v.includes("forbidden_key") && v.includes("telemetry.event_name"),
        ),
      );
    }
  });
});

describe("constants", () => {
  it("ALLOWED_MIRRORED_KEYS is a frozen Set with expected entries", () => {
    assert.ok(ALLOWED_MIRRORED_KEYS instanceof Set);
    assert.ok(Object.isFrozen(ALLOWED_MIRRORED_KEYS));
    assert.ok(ALLOWED_MIRRORED_KEYS.has("factory_id"));
    assert.ok(ALLOWED_MIRRORED_KEYS.has("lifecycle.state"));
    assert.ok(ALLOWED_MIRRORED_KEYS.has("managed_snapshot.latest_incidents[]"));
  });

  it("FORBIDDEN_HOST_LOCAL_KEYS includes domain_result", () => {
    assert.ok(FORBIDDEN_HOST_LOCAL_KEYS instanceof Set);
    assert.ok(Object.isFrozen(FORBIDDEN_HOST_LOCAL_KEYS));
    assert.ok(FORBIDDEN_HOST_LOCAL_KEYS.has("domain_result"));
    assert.ok(FORBIDDEN_HOST_LOCAL_KEYS.has("telemetry.event_name"));
  });

  it("error code constant has expected value", () => {
    assert.equal(
      MANAGED_OBSERVABILITY_BOUNDARY_ERROR_CODE,
      "managed_observability_boundary_violation",
    );
  });
});
