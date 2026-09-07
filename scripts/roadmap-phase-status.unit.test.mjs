import assert from "node:assert/strict";
import test from "node:test";

import {
  extractChecklistGateIds,
  hasConflictingChecklistState,
  isChecklistLineChecked,
} from "./lib/roadmap-phase-status.ts";

test("isChecklistLineChecked accepts checked roadmap lines with gate suffixes", () => {
  const section = `
- [x] New factories are mostly composition and configuration. Gates: \`governed_execution_dot_input_forbidden\`, \`factory_local_dot_scope_guard\`
- [ ] Shared capabilities can be reused with minimal factory-specific glue. Gates: \`factory_execution_glue_forbidden\`
`;

  assert.equal(isChecklistLineChecked(section, "New factories are mostly composition and configuration."), true);
  assert.equal(isChecklistLineChecked(section, "Shared capabilities can be reused with minimal factory-specific glue."), false);
});

test("extractChecklistGateIds returns only the gates attached to the matched checklist line", () => {
  const section = `
- [x] DOT is treated as runtime IR, not canonical source, for migrated families. Gates: \`governed_execution_dot_input_forbidden\`, \`workflow_ir_parity_contract\`, \`no_handwritten_dot_for_migrated_families\`
- [x] Generated IR parity is enforced in CI. Gates: \`workflow_ir_parity_contract\`, \`workflow_ir_runtime_parity_e2e\`
`;

  assert.deepEqual(
    extractChecklistGateIds(section, "DOT is treated as runtime IR, not canonical source, for migrated families."),
    [
      "governed_execution_dot_input_forbidden",
      "workflow_ir_parity_contract",
      "no_handwritten_dot_for_migrated_families",
    ],
  );
});

test("hasConflictingChecklistState detects duplicate checked and unchecked claims for the same label", () => {
  const section = `
- [ ] generated_governed_dot_only passes repo-wide.
- [x] generated_governed_dot_only passes repo-wide.
`;

  assert.equal(hasConflictingChecklistState(section, "generated_governed_dot_only passes repo-wide."), true);
});
