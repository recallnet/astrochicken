import { randomUUID } from "node:crypto";

export type CanonicalEventOrigin = "runtime" | "backfill";

export type CanonicalEventProvenance = {
	source_kind: string;
	source_ref: string;
	import_batch_id: string;
	imported_at: string;
};

export type CanonicalEventEnvelope = {
	schema: "canonical_event_envelope/v1";
	event_id: string;
	event_family: string;
	event_version: number;
	factory_id: string;
	run_id?: string;
	emitter: string;
	emitted_at: string;
	event_origin: CanonicalEventOrigin;
	provenance?: CanonicalEventProvenance;
	payload: Record<string, unknown>;
};

const FORBIDDEN_LLM_EMITTER_PATTERNS = [
	/^llm([.:_-]|$)/i,
	/^prompt([.:_-]|$)/i,
	/^manager([.:_-]|$)/i,
	/\.prompt([.:_-]|$)/i,
	/\.manager([.:_-]|$)/i,
];

export type CanonicalProjectorDefinition = {
	projector_id: string;
	supported_families: Array<{
		event_family: string;
		supported_versions: number[];
	}>;
};

export function buildCanonicalEventEnvelope(input: Omit<CanonicalEventEnvelope, "schema" | "event_id" | "emitted_at" | "event_origin"> & {
	event_id?: string;
	emitted_at?: string;
	event_origin?: CanonicalEventOrigin;
}): CanonicalEventEnvelope {
	return {
		schema: "canonical_event_envelope/v1",
		event_id: input.event_id || randomUUID(),
		event_family: input.event_family,
		event_version: input.event_version,
		factory_id: input.factory_id,
		run_id: input.run_id,
		emitter: input.emitter,
		emitted_at: input.emitted_at || new Date().toISOString(),
		event_origin: input.event_origin || "runtime",
		provenance: input.provenance,
		payload: input.payload,
	};
}

export function validateCanonicalEventEnvelope(envelope: CanonicalEventEnvelope): { ok: boolean; errors: string[] } {
	const errors: string[] = [];
	if (!envelope.event_family) errors.push("event_family is required");
	if (!Number.isInteger(envelope.event_version) || envelope.event_version <= 0) errors.push("event_version must be a positive integer");
	if (!envelope.factory_id) errors.push("factory_id is required");
	if (!envelope.emitter) errors.push("emitter is required");
	if (FORBIDDEN_LLM_EMITTER_PATTERNS.some((pattern) => pattern.test(envelope.emitter))) {
		errors.push("canonical event emission is forbidden from llm/prompt-managed emitters");
	}
	if (envelope.event_origin === "backfill") {
		if (!envelope.provenance) {
			errors.push("backfill provenance metadata is required");
		} else {
			if (!envelope.provenance.source_kind) errors.push("backfill provenance source_kind is required");
			if (!envelope.provenance.source_ref) errors.push("backfill provenance source_ref is required");
			if (!envelope.provenance.import_batch_id) errors.push("backfill provenance import_batch_id is required");
			if (!envelope.provenance.imported_at) errors.push("backfill provenance imported_at is required");
		}
	}
	return { ok: errors.length === 0, errors };
}

export function defineCanonicalProjector(definition: CanonicalProjectorDefinition): CanonicalProjectorDefinition {
	if (!definition.projector_id) {
		throw new Error("projector_id is required");
	}
	for (const family of definition.supported_families || []) {
		if (!family.event_family) {
			throw new Error("supported event_family is required");
		}
		if (!Array.isArray(family.supported_versions) || family.supported_versions.length === 0) {
			throw new Error(`supported_versions are required for ${family.event_family}`);
		}
	}
	return definition;
}
