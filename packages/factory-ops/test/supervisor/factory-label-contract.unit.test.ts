import assert from "node:assert/strict";
import test from "node:test";

import {
  FACTORY_LABEL_KEYS,
  buildIssueLabelEditArgs,
  getDefaultNormalizationLabelNames,
  getFactoryLabelName,
  resolveFactoryLabelContract,
  validateFactoryRepoLabels,
} from "../../src/lib/factory-label-contract.ts";

test("example-trading overlay adds factory-specific label without changing shared labels", () => {
  const mothership = resolveFactoryLabelContract("mothership");
  const replayLab = resolveFactoryLabelContract("example-trading");

  assert.equal(mothership.by_key.has(FACTORY_LABEL_KEYS.FACTORY_EXAMPLE_TRADING), false);
  assert.equal(replayLab.by_key.get(FACTORY_LABEL_KEYS.FACTORY_EXAMPLE_TRADING)?.name, "factory:example-trading");
  assert.equal(replayLab.by_key.get(FACTORY_LABEL_KEYS.READY)?.name, "ready");
});

test("example-scanner overlay exposes managed kind label without adding bespoke labels", () => {
  const exampleScanner = resolveFactoryLabelContract("example-scanner");

  assert.equal(exampleScanner.by_key.get(FACTORY_LABEL_KEYS.KIND_EXAMPLE_SCANNER)?.name, "kind:example-scanner");
  assert.equal(exampleScanner.by_key.has(FACTORY_LABEL_KEYS.FACTORY_EXAMPLE_TRADING), false);
  assert.equal(exampleScanner.by_key.get(FACTORY_LABEL_KEYS.READY)?.name, "ready");
});

test("default normalization labels exclude control-plane and human escalation labels", () => {
  const labels = getDefaultNormalizationLabelNames("mothership");
  assert.equal(labels.includes("blocked-control-plane"), false);
  assert.equal(labels.includes("human"), false);
  assert.equal(labels.includes("ready"), true);
  assert.equal(labels.includes("not-planned"), true);
});

test("buildIssueLabelEditArgs resolves registered label keys into gh edit args", () => {
  const args = buildIssueLabelEditArgs({
    repo: "recallnet/astrochicken",
    issueNumber: 42,
    factoryId: "mothership",
    addKeys: [FACTORY_LABEL_KEYS.READY],
    removeKeys: [FACTORY_LABEL_KEYS.READY],
  });

  assert.deepEqual(args, [
    "issue",
    "edit",
    "42",
    "--repo",
    "recallnet/astrochicken",
    "--add-label",
    "ready",
    "--remove-label",
    "ready",
  ]);
});

test("validateFactoryRepoLabels reports missing and mismatched labels", () => {
  const result = validateFactoryRepoLabels({
    repo: "recallnet/astrochicken",
    factoryId: "example-trading",
    ghJsonExec: () => ([
      { name: getFactoryLabelName("example-trading", FACTORY_LABEL_KEYS.FACTORY_EXAMPLE_TRADING), description: "wrong", color: "ffffff" },
      { name: getFactoryLabelName("example-trading", FACTORY_LABEL_KEYS.READY), description: "Ready for execution", color: "0e8a16" },
    ]),
  });

  assert.equal(result.ok, false);
  assert.match(result.missing.join(","), /goal/);
  assert.equal(result.mismatched[0].name, "factory:example-trading");
});
