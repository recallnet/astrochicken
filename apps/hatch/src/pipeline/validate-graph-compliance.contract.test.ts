/**
 * Contract test: all production graph files pass node schema validation.
 *
 * Validates every factory and capability graph against the typed node schema
 * using the same parse → validate pipeline as `hatch validate`. Catches:
 * - Boolean attribute typos (e.g., fail_open="tru")
 * - Enum value typos (e.g., governance="reversble")
 * - Missing required attributes per handler type
 * - Cross-attribute constraint violations
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { NODE_SCHEMA_RULE_CODES } from "./node-schema.js";
import { parse } from "./parse.js";
import { formatValidationError, validate } from "./validate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../../");

const SCHEMA_ERROR_CODES = new Set(Object.values(NODE_SCHEMA_RULE_CODES));

function discoverGraphFiles(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((name) => name.endsWith(".dot"))
		.map((name) => path.join(dir, name));
}

function schemaErrors(filePath: string) {
	const content = readFileSync(filePath, "utf8");
	const graph = parse(content);
	return validate(graph).filter(
		(e) => e.code && SCHEMA_ERROR_CODES.has(e.code) && e.severity !== "warning",
	);
}

function relPath(filePath: string): string {
	return path.relative(repoRoot, filePath);
}

// Factory graphs
const factories = ["mothership", "brainstorm", "example-trading", "research"];
for (const factoryId of factories) {
	const graphDir = path.join(repoRoot, "factories", factoryId, "graphs");
	const files = discoverGraphFiles(graphDir);
	if (files.length === 0) continue;

	describe(`factory ${factoryId} graph schema compliance`, () => {
		for (const filePath of files) {
			it(`${relPath(filePath)} passes node schema validation`, () => {
				const errors = schemaErrors(filePath);
				if (errors.length > 0) {
					const formatted = errors.map(formatValidationError).join("\n  ");
					expect.fail(`${errors.length} schema error(s):\n  ${formatted}`);
				}
			});
		}
	});
}

// Capability package graphs
const capabilityPrefixes = [
	"capability-artifact-ingestion",
	"capability-brainstorming",
	"capability-coding",
	"capability-goal-decomposition",
	"capability-merge",
	"capability-product-judge",
	"capability-release-reporting",
	"capability-software-development",
	"capability-triage",
	"capability-wave-dispatch",
];

describe("capability package graph schema compliance", () => {
	for (const prefix of capabilityPrefixes) {
		const graphDir = path.join(repoRoot, "packages", prefix, "graphs");
		const files = discoverGraphFiles(graphDir);
		if (files.length === 0) continue;

		for (const filePath of files) {
			it(`${relPath(filePath)} passes node schema validation`, () => {
				const errors = schemaErrors(filePath);
				if (errors.length > 0) {
					const formatted = errors.map(formatValidationError).join("\n  ");
					expect.fail(`${errors.length} schema error(s):\n  ${formatted}`);
				}
			});
		}
	}
});

// External factory example graphs
describe("external factory example graph schema compliance", () => {
	const externalDir = path.join(repoRoot, "examples/external-factories/acme-support/graphs");
	const files = discoverGraphFiles(externalDir);
	for (const filePath of files) {
		it(`${relPath(filePath)} passes node schema validation`, () => {
			const errors = schemaErrors(filePath);
			if (errors.length > 0) {
				const formatted = errors.map(formatValidationError).join("\n  ");
				expect.fail(`${errors.length} schema error(s):\n  ${formatted}`);
			}
		});
	}
});
