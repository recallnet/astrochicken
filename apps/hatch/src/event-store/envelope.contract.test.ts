import { describe, expect, it } from "vitest";

import {
	buildCanonicalEventEnvelope,
	defineCanonicalProjector,
	validateCanonicalEventEnvelope,
} from "./envelope.js";

describe("canonical event envelope", () => {
	it("requires provenance metadata for backfilled history", () => {
		const envelope = buildCanonicalEventEnvelope({
			event_family: "goal.selected",
			event_version: 1,
			factory_id: "example-trading",
			emitter: "apps.hatch.runtime",
			event_origin: "backfill",
			payload: { issue_number: 1462 },
		});

		const result = validateCanonicalEventEnvelope(envelope);
		expect(result.ok).toBe(false);
		expect(result.errors).toContain("backfill provenance metadata is required");
	});

	it("accepts runtime envelopes and preserved backfill provenance", () => {
		const runtimeEnvelope = buildCanonicalEventEnvelope({
			event_family: "goal.selected",
			event_version: 1,
			factory_id: "example-trading",
			emitter: "apps.hatch.runtime",
			payload: { issue_number: 1462 },
		});

		const runtimeResult = validateCanonicalEventEnvelope(runtimeEnvelope);
		expect(runtimeResult.ok).toBe(true);

		const importedEnvelope = buildCanonicalEventEnvelope({
			event_family: "goal.selected",
			event_version: 1,
			factory_id: "example-trading",
			emitter: "packages.factory-ops.backfill",
			event_origin: "backfill",
			provenance: {
				source_kind: "run_state",
				source_ref: "state.json",
				import_batch_id: "batch-01",
				imported_at: "2026-03-25T00:00:00.000Z",
			},
			payload: { issue_number: 1462 },
		});

		const importedResult = validateCanonicalEventEnvelope(importedEnvelope);
		expect(importedResult.ok).toBe(true);
	});

	it("rejects llm or prompt-managed emitters", () => {
		const envelope = buildCanonicalEventEnvelope({
			event_family: "factory.issue.created",
			event_version: 1,
			factory_id: "example-trading",
			emitter: "llm.manager.review",
			payload: { issue_number: 1541 },
		});

		const result = validateCanonicalEventEnvelope(envelope);
		expect(result.ok).toBe(false);
		expect(result.errors).toContain("canonical event emission is forbidden from llm/prompt-managed emitters");
	});

	it("requires projectors to declare supported versions", () => {
		expect(() =>
			defineCanonicalProjector({
				projector_id: "status_projection",
				supported_families: [{ event_family: "goal.selected", supported_versions: [] }],
			}),
		).toThrow(/supported_versions/i);
	});
});
