import assert from "node:assert/strict";
import test from "node:test";

import { waveEnsureLabels } from "../src/commands/wave-ensure-labels.ts";
import {
  FACTORY_LABEL_KEYS,
  getFactoryLabelNames,
} from "../src/lib/factory-label-contract.ts";

const DEFAULT_WAVE_LABEL_KEYS = [
  FACTORY_LABEL_KEYS.READY,
  FACTORY_LABEL_KEYS.WAVE_IN_PROGRESS,
  FACTORY_LABEL_KEYS.PRIORITIES,
  FACTORY_LABEL_KEYS.QUARANTINED,
  FACTORY_LABEL_KEYS.BLOCKED_CONTROL_PLANE,
];

const DEFAULT_WAVE_LABEL_NAMES = getFactoryLabelNames("mothership", DEFAULT_WAVE_LABEL_KEYS);

test("FACTORY_LABEL_KEYS covers all wave-managed labels with valid metadata", () => {
  for (const key of DEFAULT_WAVE_LABEL_KEYS) {
    const name = getFactoryLabelNames("mothership", [key])[0];
    assert.ok(name, `missing wave label for key ${key}`);
    assert.equal(typeof name, "string");
    assert.ok(name.length > 0, `empty label name for key ${key}`);
  }
});

test("waveEnsureLabels syncs only wave-managed labels from registry subset", () => {
  const calls = [];
  const out = waveEnsureLabels({
    repo: "recallnet/astrochicken",
    ghExec: (args) => {
      calls.push(args);
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  assert.equal(out.ok, true);
  assert.deepEqual(out.labels.sort((a, b) => a.localeCompare(b)), [...DEFAULT_WAVE_LABEL_NAMES].sort((a, b) => a.localeCompare(b)));
  assert.equal(calls.length, DEFAULT_WAVE_LABEL_NAMES.length);

  const createdNames = calls.map((args) => {
    // args are like ["label", "create", <name>, "--repo", ...]
    return args[2];
  }).sort((a, b) => a.localeCompare(b));
  assert.deepEqual(createdNames, [...DEFAULT_WAVE_LABEL_NAMES].sort((a, b) => a.localeCompare(b)));
});
