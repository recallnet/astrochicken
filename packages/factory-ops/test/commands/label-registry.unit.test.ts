import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CORE_LABEL_TYPES,
  CORE_LABEL_REGISTRY,
  CORE_LABEL_NAMES,
  CORE_LABELS_FOR_SYNC,
} from "../../src/lib/label-registry.ts";

const TYPE_SET = new Set(CORE_LABEL_TYPES);

describe("CORE_LABEL_TYPES", () => {
  it("is a frozen array", () => {
    assert.ok(Object.isFrozen(CORE_LABEL_TYPES));
    assert.ok(Array.isArray(CORE_LABEL_TYPES));
  });

  it("contains exactly the five expected types", () => {
    assert.deepEqual([...CORE_LABEL_TYPES].sort(), [
      "gate",
      "informational",
      "lifecycle",
      "state",
      "type",
    ]);
  });

  it("has no duplicates", () => {
    const unique = new Set(CORE_LABEL_TYPES);
    assert.equal(unique.size, CORE_LABEL_TYPES.length);
  });
});

describe("CORE_LABEL_REGISTRY", () => {
  it("is a frozen array", () => {
    assert.ok(Object.isFrozen(CORE_LABEL_REGISTRY));
    assert.ok(Array.isArray(CORE_LABEL_REGISTRY));
  });

  it("contains at least 16 entries", () => {
    assert.ok(CORE_LABEL_REGISTRY.length >= 16, `expected >= 16 entries, got ${CORE_LABEL_REGISTRY.length}`);
  });

  it("every entry has all required fields", () => {
    for (const entry of CORE_LABEL_REGISTRY) {
      assert.equal(typeof entry.name, "string", "name must be a string");
      assert.ok(entry.name.length > 0, "name must be non-empty");

      assert.equal(typeof entry.description, "string", `${entry.name}: description must be a string`);
      assert.ok(entry.description.length > 0, `${entry.name}: description must be non-empty`);

      assert.equal(typeof entry.color, "string", `${entry.name}: color must be a string`);
      assert.match(entry.color, /^[0-9a-fA-F]{6}$/, `${entry.name}: color must be 6-char hex`);

      assert.equal(typeof entry.type, "string", `${entry.name}: type must be a string`);
      assert.ok(TYPE_SET.has(entry.type), `${entry.name}: type "${entry.type}" is not in CORE_LABEL_TYPES`);

      assert.equal(typeof entry.owner, "string", `${entry.name}: owner must be a string`);
      assert.ok(entry.owner.length > 0, `${entry.name}: owner must be non-empty`);
    }
  });

  it("each entry is individually frozen", () => {
    for (const entry of CORE_LABEL_REGISTRY) {
      assert.ok(Object.isFrozen(entry), `${entry.name}: entry should be frozen`);
    }
  });

  it("has no duplicate names", () => {
    const names = CORE_LABEL_REGISTRY.map((e) => e.name);
    const unique = new Set(names);
    assert.equal(unique.size, names.length, "registry should have no duplicate names");
  });

  it("contains all required core labels", () => {
    const names = new Set(CORE_LABEL_REGISTRY.map((e) => e.name));
    const required = [
      "goal", "feature", "bug", "ready", "wave-in-progress", "triaged",
      "duplicate", "priorities", "artifacts", "telemetry", "quarantined",
      "deferred", "factory-tracking", "process",
      "human", "awaiting-human",
    ];
    for (const name of required) {
      assert.ok(names.has(name), `registry should contain "${name}"`);
    }
  });

  it("maps known labels to expected types", () => {
    const byName = new Map(CORE_LABEL_REGISTRY.map((e) => [e.name, e]));

    assert.equal(byName.get("goal").type, "type");
    assert.equal(byName.get("feature").type, "type");
    assert.equal(byName.get("bug").type, "type");
    assert.equal(byName.get("ready").type, "lifecycle");
    assert.equal(byName.get("wave-in-progress").type, "state");
    assert.equal(byName.get("triaged").type, "state");
    assert.equal(byName.get("duplicate").type, "state");
    assert.equal(byName.get("priorities").type, "lifecycle");
    assert.equal(byName.get("artifacts").type, "informational");
    assert.equal(byName.get("telemetry").type, "informational");
    assert.equal(byName.get("quarantined").type, "gate");
    assert.equal(byName.get("deferred").type, "state");
    assert.equal(byName.get("factory-tracking").type, "informational");
    assert.equal(byName.get("process").type, "informational");
    assert.equal(byName.get("human").type, "gate");
    assert.equal(byName.get("awaiting-human").type, "gate");
  });

  it("maps known labels to expected owners", () => {
    const byName = new Map(CORE_LABEL_REGISTRY.map((e) => [e.name, e]));

    assert.equal(byName.get("goal").owner, "goal-queue-ops");
    assert.equal(byName.get("feature").owner, "write-issue-item");
    assert.equal(byName.get("bug").owner, "supervisor-artifact");
    assert.equal(byName.get("ready").owner, "wave-create-ready");
    assert.equal(byName.get("wave-in-progress").owner, "wave-claim");
    assert.equal(byName.get("triaged").owner, "triage-apply-status");
    assert.equal(byName.get("duplicate").owner, "triage-apply-terminal-status");
    assert.equal(byName.get("quarantined").owner, "wave-handle-review-failures");
    assert.equal(byName.get("deferred").owner, "triage-apply-terminal-status");
    assert.equal(byName.get("human").owner, "human-blocker");
    assert.equal(byName.get("awaiting-human").owner, "human-blocker");
  });
});

describe("CORE_LABEL_NAMES", () => {
  it("is a frozen array", () => {
    assert.ok(Object.isFrozen(CORE_LABEL_NAMES));
    assert.ok(Array.isArray(CORE_LABEL_NAMES));
  });

  it("is a deterministic projection of registry names in order", () => {
    const expected = CORE_LABEL_REGISTRY.map((e) => e.name);
    assert.deepEqual(CORE_LABEL_NAMES, expected);
  });

  it("has the same length as the registry", () => {
    assert.equal(CORE_LABEL_NAMES.length, CORE_LABEL_REGISTRY.length);
  });
});

describe("CORE_LABELS_FOR_SYNC", () => {
  it("is a frozen array", () => {
    assert.ok(Object.isFrozen(CORE_LABELS_FOR_SYNC));
    assert.ok(Array.isArray(CORE_LABELS_FOR_SYNC));
  });

  it("has the same length as the registry", () => {
    assert.equal(CORE_LABELS_FOR_SYNC.length, CORE_LABEL_REGISTRY.length);
  });

  it("contains only name, description, and color for each entry", () => {
    for (const entry of CORE_LABELS_FOR_SYNC) {
      const keys = Object.keys(entry).sort();
      assert.deepEqual(keys, ["color", "description", "name"], `entry "${entry.name}" should have exactly name/description/color`);
    }
  });

  it("does NOT include owner or type fields", () => {
    for (const entry of CORE_LABELS_FOR_SYNC) {
      assert.equal(Object.prototype.hasOwnProperty.call(entry, "owner"), false, `${entry.name}: should not have owner`);
      assert.equal(Object.prototype.hasOwnProperty.call(entry, "type"), false, `${entry.name}: should not have type`);
    }
  });

  it("matches registry entries for name/description/color", () => {
    for (let i = 0; i < CORE_LABEL_REGISTRY.length; i++) {
      const reg = CORE_LABEL_REGISTRY[i];
      const sync = CORE_LABELS_FOR_SYNC[i];
      assert.equal(sync.name, reg.name);
      assert.equal(sync.description, reg.description);
      assert.equal(sync.color, reg.color);
    }
  });

  it("each sync entry is individually frozen", () => {
    for (const entry of CORE_LABELS_FOR_SYNC) {
      assert.ok(Object.isFrozen(entry), `${entry.name}: sync entry should be frozen`);
    }
  });

  it("sync labels are a strict subset of registry (by name)", () => {
    const registryNames = new Set(CORE_LABEL_REGISTRY.map((e) => e.name));
    for (const entry of CORE_LABELS_FOR_SYNC) {
      assert.ok(registryNames.has(entry.name), `sync entry "${entry.name}" must exist in registry`);
    }
  });
});
