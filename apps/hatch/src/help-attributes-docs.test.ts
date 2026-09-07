import { describe, expect, it } from "vitest";

import { helpTopics } from "./help.js";
import { AGENT_IDS_V1, AGENT_ROLES_V1, DEFAULT_AGENT_IDENTITY_FALLBACK_V1 } from "./pipeline/governance.js";

describe("help attributes identity contract docs", () => {
	it("documents agent_id/agent_role domains and fallback model", () => {
		const text = helpTopics.attributes;

		expect(text).toContain("agent_id                  Stable agent identity id for trust telemetry/contracts");
		expect(text).toContain(`Allowed values: ${AGENT_IDS_V1.join(", ")}`);
		expect(text).toContain(
			`Fallback model: explicit valid agent_id → trust-participant map → ${DEFAULT_AGENT_IDENTITY_FALLBACK_V1.agentId}`,
		);

		expect(text).toContain("agent_role                Stable agent identity role for trust telemetry/contracts");
		expect(text).toContain(`Allowed values: ${AGENT_ROLES_V1.join(", ")}`);
		expect(text).toContain(
			`Fallback model: explicit valid agent_role → trust-participant map → ${DEFAULT_AGENT_IDENTITY_FALLBACK_V1.agentRole}`,
		);
	});

	it("documents deterministic decision artifact objective fallback rule", () => {
		const text = helpTopics.attributes;
		expect(text).toContain("objective_id              Optional objective identifier for decision artifacts;");
		expect(text).toContain("fallback: intent_ref@intent_profile, else intent.unbound");
	});

	it("documents shared composite handler contract for pipeline and fan_out.dynamic", () => {
		const text = helpTopics.nodes;
		expect(text).toContain("Child failure causes parent failure (reason=\"child_failed\")");
		expect(text).toContain("Child timeout normalizes to reason=\"child_timeout\"");
		expect(text).toContain("External abort normalizes to reason=\"child_aborted\"");
		expect(text).toContain("export_keys write back only after child success; failures skip writeback");
		expect(text).toContain("export_keys write back only for successful children");
	});

	it("documents estimator complexity routing convention", () => {
		const edgesText = helpTopics.edges;
		expect(edgesText).toContain("Complexity class routing (estimator -> low/medium/high):");
		expect(edgesText).toContain("condition=\"complexity_class=low\"");
		expect(edgesText).toContain("condition=\"complexity_class=medium\"");
		expect(edgesText).toContain("condition=\"complexity_class=high\"");
		expect(edgesText).toContain("hatch complexity estimate");

		const attrsText = helpTopics.attributes;
		expect(attrsText).toContain("complexity convention     Use hatch complexity estimate for deterministic");
		expect(attrsText).toContain("outputs=\"complexity_class,signals,reason\"");
		expect(attrsText).toContain("otel_dimension_key (hatch.complexity.class)");
		expect(attrsText).toContain("docs/reference/complexity-floor-estimator.md");

		const validationText = helpTopics.validation;
		expect(validationText).toContain("complexity_estimator_provenance (warning, hatch validate)");
		expect(validationText).toContain("complexity_routing_context_flow (warning, lint-dot)");
		expect(validationText).toContain("context_flow.undefined_reference");
		expect(validationText).toContain("stage.finish data should include complexity_class");
		expect(validationText).toContain("docs/reference/complexity-floor-estimator.md");
	});

	it("documents mode-first guidance with managed-only and standalone annotations", () => {
		const modesText = helpTopics.modes;
		expect(modesText).toContain("HATCH MODES: STANDALONE VS MANAGED");
		expect(modesText).toContain("Hatch supports two canonical factory modes: standalone, managed.");
		expect(modesText).toContain("hatch-ops factory status");
		expect(modesText).toContain("mode: both");
		expect(modesText).toContain("hatch-ops factory host-*");
		expect(modesText).toContain("managed-only");
		expect(modesText).toContain("Standalone (mode: standalone)");
		expect(modesText).toContain("Managed (managed-only overlays)");
		expect(modesText).toContain("fail closed with non-zero");
	});
});
