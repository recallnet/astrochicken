import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface IntentFixture {
	schema: string;
	id: string;
	title: string;
	summary: string;
	status?: string;
	owners?: string[];
	goals?: string[];
	constraints?: string[];
	acceptance_criteria?: string[];
	profiles?: Record<string, ProfileFixture>;
	references?: Record<string, string>;
}

interface ProfileFixture {
	audience?: string;
	goals?: string[];
	constraints?: string[];
	acceptance_criteria?: string[];
}

interface PatchDocument {
	schema: string;
	intent_id: string;
	operations: PatchOperation[];
}

interface PatchOperation {
	op: "add" | "replace";
	path: string;
	value: JsonValue;
}

const fixtureUrl = (filename: string) => new URL(`../../../../context/intent/${filename}`, import.meta.url);

const readFixture = async <T>(filename: string): Promise<T> => {
	const raw = await readFile(fixtureUrl(filename), "utf8");
	return JSON.parse(raw) as T;
};

const decodePointer = (value: string) => value.replace(/~1/g, "/").replace(/~0/g, "~");

const applyPatch = <T extends JsonValue>(base: T, patch: PatchDocument): T => {
	const result = structuredClone(base);
	for (const operation of patch.operations) {
		applyOperation(result, operation);
	}
	return result;
};

const applyOperation = (target: JsonValue, operation: PatchOperation): void => {
	const segments = operation.path.split("/").slice(1).map(decodePointer);
	if (segments.length === 0) {
		throw new Error("Root patch operations are not supported in fixtures.");
	}

	let current: JsonValue = target;
	for (let index = 0; index < segments.length - 1; index += 1) {
		if (current === null || typeof current !== "object") {
			throw new Error(`Invalid patch path: ${operation.path}`);
		}
		current = (current as Record<string, JsonValue>)[segments[index]];
	}

	const last = segments[segments.length - 1];
	if (Array.isArray(current)) {
		if (last === "-") {
			current.push(operation.value);
			return;
		}
		const position = Number(last);
		if (Number.isNaN(position)) {
			throw new Error(`Invalid array index in patch path: ${operation.path}`);
		}
		current[position] = operation.value;
		return;
	}

	if (current === null || typeof current !== "object") {
		throw new Error(`Invalid patch path: ${operation.path}`);
	}

	(current as Record<string, JsonValue>)[last] = operation.value;
};

describe("intent sample fixtures", () => {
	it("loads the base intent fixture", async () => {
		const base = await readFixture<IntentFixture>("base.intent.json");

		expect(base.schema).toBe("hatch.intent.v1");
		expect(base.id).toBe("intent.sample.onboarding");
		expect(base.goals).toContain("Reduce time to first successful action");
		expect(base.acceptance_criteria).toContain("Users can skip the flow and resume later");
	});

	it("includes profile overrides", async () => {
		const intent = await readFixture<IntentFixture>("profiles.intent.json");

		expect(intent.schema).toBe("hatch.intent.v1");
		expect(intent.profiles).toBeDefined();
		expect(intent.profiles?.enterprise.constraints).toContain("Must support SSO");
		expect(intent.profiles?.self_serve.acceptance_criteria).toContain(
			"Onboarding completes in under two minutes",
		);
	});

	it("applies patch fixtures to the base intent", async () => {
		const base = await readFixture<IntentFixture>("base.intent.json");
		const patch = await readFixture<PatchDocument>("patch.intent.json");
		const expected = await readFixture<IntentFixture>("patch.expected.json");

		expect(patch.schema).toBe("hatch.intent.patch.v1");
		expect(patch.intent_id).toBe(base.id);

		const patched = applyPatch(base as JsonValue, patch) as IntentFixture;

		expect(patched).toEqual(expected);
	});
});
