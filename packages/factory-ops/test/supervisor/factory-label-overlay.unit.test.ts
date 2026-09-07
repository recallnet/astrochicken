import assert from "node:assert/strict";
import test from "node:test";

import {
  FACTORY_LABEL_OVERLAY_CATEGORIES,
  FactoryLabelOverlayValidationError,
  validateFactoryLabelOverlay,
  mergeFactoryLabelRegistryOverlay,
} from "../../src/lib/factory-label-overlay.ts";
import { globalFactoryLabelRegistry } from "../../src/lib/factory-label-registry.ts";
import {
  mothershipFactoryLabelOverlay,
  mothershipFactoryLabelRegistry,
} from "../../src/lib/mothership-label-overlay.ts";

function validOverlayEntry(overrides = {}) {
  return {
    name: "overlay-sample",
    category: "control",
    owner: "tests",
    description: "Overlay sample label",
    color: "a1b2c3",
    include_by_default: true,
    wave_ready: false,
    ...overrides,
  };
}

test("overlay categories mirror core registry categories", () => {
  assert.deepEqual([...FACTORY_LABEL_OVERLAY_CATEGORIES], ["type", "state", "queue", "control", "artifact"]);
});

test("validateFactoryLabelOverlay rejects missing label name", () => {
  assert.throws(() => {
    validateFactoryLabelOverlay({
      overlay: [validOverlayEntry({ name: "" })],
      coreRegistry: globalFactoryLabelRegistry,
    });
  }, (error) => {
    assert.equal(error instanceof FactoryLabelOverlayValidationError, true);
    assert.equal(error.reason, "missing_name");
    return true;
  });
});

test("validateFactoryLabelOverlay rejects wrong category", () => {
  assert.throws(() => {
    validateFactoryLabelOverlay({
      overlay: [validOverlayEntry({ name: "x-category", category: "invalid" })],
      coreRegistry: globalFactoryLabelRegistry,
    });
  }, (error) => {
    assert.equal(error instanceof FactoryLabelOverlayValidationError, true);
    assert.equal(error.label_name, "x-category");
    assert.equal(error.reason, "invalid_category");
    return true;
  });
});

test("validateFactoryLabelOverlay rejects duplicate overlay names", () => {
  assert.throws(() => {
    validateFactoryLabelOverlay({
      overlay: [
        validOverlayEntry({ name: "duplicate-overlay" }),
        validOverlayEntry({ name: "duplicate-overlay", color: "bbbbbb" }),
      ],
      coreRegistry: globalFactoryLabelRegistry,
    });
  }, (error) => {
    assert.equal(error instanceof FactoryLabelOverlayValidationError, true);
    assert.equal(error.label_name, "duplicate-overlay");
    assert.equal(error.reason, "duplicate_overlay_name");
    return true;
  });
});

test("validateFactoryLabelOverlay rejects invalid colors and missing descriptions", () => {
  assert.throws(() => {
    validateFactoryLabelOverlay({
      overlay: [validOverlayEntry({ name: "bad-color", color: "#ff00aa" })],
      coreRegistry: globalFactoryLabelRegistry,
    });
  }, (error) => {
    assert.equal(error instanceof FactoryLabelOverlayValidationError, true);
    assert.equal(error.reason, "invalid_color_hex");
    return true;
  });

  assert.throws(() => {
    validateFactoryLabelOverlay({
      overlay: [validOverlayEntry({ name: "missing-description", description: "" })],
      coreRegistry: globalFactoryLabelRegistry,
    });
  }, (error) => {
    assert.equal(error instanceof FactoryLabelOverlayValidationError, true);
    assert.equal(error.reason, "missing_description");
    return true;
  });
});

test("validateFactoryLabelOverlay rejects overlay/core collisions", () => {
  assert.throws(() => {
    validateFactoryLabelOverlay({
      overlay: [validOverlayEntry({ name: "ready" })],
      coreRegistry: globalFactoryLabelRegistry,
    });
  }, (error) => {
    assert.equal(error instanceof FactoryLabelOverlayValidationError, true);
    assert.equal(error.label_name, "ready");
    assert.equal(error.reason, "overlay_core_collision");
    return true;
  });
});

test("mergeFactoryLabelRegistryOverlay keeps core first, appends overlay, does not mutate inputs", () => {
  const core = Object.freeze([
    Object.freeze({ name: "core-1", category: "control", owner: "core", description: "Core label", color: "111111", include_by_default: true, wave_ready: false }),
  ]);
  const overlay = Object.freeze([
    Object.freeze({ name: "overlay-1", category: "control", owner: "overlay", description: "Overlay label", color: "222222", include_by_default: true, wave_ready: false }),
  ]);

  const merged = mergeFactoryLabelRegistryOverlay({ coreRegistry: core, overlay });
  assert.deepEqual(merged.map((entry) => entry.name), ["core-1", "overlay-1"]);
  assert.deepEqual(core.map((entry) => entry.name), ["core-1"]);
  assert.deepEqual(overlay.map((entry) => entry.name), ["overlay-1"]);
});

test("mothershipFactoryLabelRegistry propagates validation errors on conflict", () => {
  assert.throws(() => {
    mergeFactoryLabelRegistryOverlay({
      coreRegistry: globalFactoryLabelRegistry,
      overlay: [validOverlayEntry({ name: "goal" })],
    });
  }, FactoryLabelOverlayValidationError);
});

test("mothershipFactoryLabelOverlay validates cleanly and includes required labels", () => {
  const validated = validateFactoryLabelOverlay({
    overlay: mothershipFactoryLabelOverlay,
    coreRegistry: globalFactoryLabelRegistry,
  });

  const names = validated.map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
  assert.deepEqual(names, [
    "awaiting-human",
    "blocked",
    "blocked-control-plane",
    "factory:example-trading",
    "human",
    "managed-factory-bug",
    "merge-followup",
    "needs-triage",
  ]);

  const merged = mothershipFactoryLabelRegistry();
  assert.equal(Array.isArray(merged), true);
  assert.equal(merged.length, globalFactoryLabelRegistry.length + mothershipFactoryLabelOverlay.length);
});
