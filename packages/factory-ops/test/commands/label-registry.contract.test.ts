import assert from "node:assert/strict";
import test from "node:test";

import { normalizeIssueLabels } from "../../src/commands/labels-normalize.ts";
import {
  CORE_LABEL_REGISTRY,
  CORE_LABEL_NAMES,
  CORE_LABELS_FOR_SYNC,
  CORE_LABEL_TYPES,
} from "../../src/lib/label-registry.ts";

const TYPE_SET = new Set(CORE_LABEL_TYPES);

test("CORE_LABEL_REGISTRY entries are metadata-complete and typed", () => {
  for (const entry of CORE_LABEL_REGISTRY) {
    assert.equal(typeof entry.name, "string");
    assert.ok(entry.name.length > 0, "name is required");

    assert.equal(typeof entry.description, "string");
    assert.ok(entry.description.length > 0, `${entry.name}: description is required`);

    assert.equal(typeof entry.color, "string");
    assert.match(entry.color, /^[0-9a-f]{6}$/i, `${entry.name}: color must be 6-char hex`);

    assert.equal(typeof entry.owner, "string");
    assert.ok(entry.owner.length > 0, `${entry.name}: owner is required`);

    assert.equal(typeof entry.type, "string");
    assert.ok(TYPE_SET.has(entry.type), `${entry.name}: invalid type ${entry.type}`);
  }
});

test("CORE_LABEL_NAMES and CORE_LABELS_FOR_SYNC are deterministic projections", () => {
  const expectedNames = CORE_LABEL_REGISTRY.map((entry) => entry.name);
  assert.deepEqual(CORE_LABEL_NAMES, expectedNames);

  const expectedSync = CORE_LABEL_REGISTRY.map(({ name, description, color }) => ({ name, description, color }));
  assert.deepEqual(CORE_LABELS_FOR_SYNC, expectedSync);

  for (const entry of CORE_LABELS_FOR_SYNC) {
    assert.equal(Object.prototype.hasOwnProperty.call(entry, "owner"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(entry, "type"), false);
  }
});

test("normalizeIssueLabels keeps registry labels when allowlist mirrors CORE_LABEL_NAMES", async () => {
  const out = await normalizeIssueLabels({
    repo: "recallnet/astrochicken",
    allowed: CORE_LABEL_NAMES,
    state: "open",
    dryRun: true,
    issues: [
      {
        number: 1,
        title: "registry coverage",
        body: "INSTRUCTION_CONFLICT: preserve gate-only labels during normalization",
        labels: CORE_LABEL_NAMES.map((name) => ({ name })),
      },
    ],
  });

  assert.equal(out.changed, 0);
  assert.equal(out.removed, 0);
  assert.deepEqual(out.issues, []);
});

