import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadIntentRegistry } from "./loader.js";

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

describe("intent registry loader", () => {
	it("loads valid intent documents", () => {
		const registry = loadIntentRegistry({
			rootDir: fixtureDir,
			intentPaths: ["valid.intent.json"],
		});

		expect(registry).not.toBeNull();
		expect(registry?.intents["intent.test.feature"]).toBeDefined();
		expect(registry?.intents["intent.test.feature"].profiles.default.title).toBe("Intent loader test");
		expect(registry?.intents["intent.test.feature"].profiles.enterprise.summary).toBe(
			"Ensure the loader accepts valid intent documents.",
		);
		expect(registry?.intents["intent.test.feature"].profiles.enterprise.constraints).toContain(
			"Must support audit logs",
		);
	});

	it("rejects unknown keys", () => {
		expect(() =>
			loadIntentRegistry({
				rootDir: fixtureDir,
				intentPaths: ["unknown-key.intent.json"],
			}),
		).toThrow(/unknown key/i);
	});

	it("errors on missing intent files", () => {
		expect(() =>
			loadIntentRegistry({
				rootDir: fixtureDir,
				intentPaths: ["missing.intent.json"],
			}),
		).toThrow(/not found/i);
	});
});
