import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
	INTENT_SCHEMA_VERSION,
	IntentSchemaError,
	parseIntentDocument,
	type IntentDocument,
} from "./schema.js";
import {
	DEFAULT_INTENT_PROFILE,
	type IntentData,
	type IntentDefinition,
	type IntentRegistry,
} from "../pipeline/intent.js";

export interface IntentRegistryLoadOptions {
	rootDir?: string;
	intentPaths?: string[];
}

export interface IntentLoadIssue {
	path: string;
	message: string;
}

export class IntentLoadError extends Error {
	constructor(public issues: IntentLoadIssue[]) {
		super(formatIntentLoadIssues(issues));
	}
}

const ENV_INTENT_PATHS = "HATCH_INTENT_PATHS";
const DEFAULT_INTENT_DIR = "context/intent";
const INTENT_PATCH_SCHEMA_VERSION = "hatch.intent.patch.v1";

export function loadIntentRegistry(options: IntentRegistryLoadOptions = {}): IntentRegistry | null {
	const rootDir = options.rootDir ?? process.cwd();
	const paths = resolveIntentPaths(rootDir, options.intentPaths);
	if (paths.length === 0) return null;

	const issues: IntentLoadIssue[] = [];
	const files: string[] = [];

	for (const rawPath of paths) {
		const resolvedPath = resolve(rootDir, rawPath);
		if (!existsSync(resolvedPath)) {
			issues.push({ path: resolvedPath, message: "intent path not found" });
			continue;
		}
		collectIntentFiles(resolvedPath, files);
	}

	if (issues.length > 0) {
		throw new IntentLoadError(issues);
	}

	const uniqueFiles = Array.from(new Set(files)).sort();
	if (uniqueFiles.length === 0) {
		throw new IntentLoadError([{ path: rootDir, message: "no intent files found in configured paths" }]);
	}

	const registry: IntentRegistry = { intents: {} };

	for (const filePath of uniqueFiles) {
		let raw: string;
		try {
			raw = readFileSync(filePath, "utf8");
		} catch (err) {
			issues.push({
				path: filePath,
				message: `failed to read intent file: ${err instanceof Error ? err.message : String(err)}`,
			});
			continue;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (err) {
			issues.push({
				path: filePath,
				message: `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
			});
			continue;
		}

		const schema = isPlainObject(parsed) ? parsed.schema : undefined;
		if (schema === INTENT_PATCH_SCHEMA_VERSION) {
			continue;
		}

		if (schema !== INTENT_SCHEMA_VERSION) {
			issues.push({
				path: filePath,
				message: `unsupported schema "${schema ?? "(missing)"}"`,
			});
			continue;
		}

		let doc: IntentDocument;
		try {
			doc = parseIntentDocument(parsed);
		} catch (err) {
			if (err instanceof IntentSchemaError) {
				for (const issue of err.issues) {
					const issuePath = issue.path ? `${filePath}:${issue.path}` : filePath;
					issues.push({ path: issuePath, message: issue.message });
				}
				continue;
			}
			issues.push({
				path: filePath,
				message: err instanceof Error ? err.message : "intent schema validation failed",
			});
			continue;
		}

		if (registry.intents[doc.id]) {
			issues.push({ path: filePath, message: `duplicate intent id "${doc.id}"` });
			continue;
		}

		registry.intents[doc.id] = buildIntentDefinition(doc);
	}

	if (issues.length > 0) {
		throw new IntentLoadError(issues);
	}

	return registry;
}

export function findRepoRoot(startDir: string): string {
	let current = resolve(startDir);
	while (true) {
		if (existsSync(join(current, ".git"))) return current;
		const parent = dirname(current);
		if (parent === current) return startDir;
		current = parent;
	}
}

export function formatIntentLoadIssues(issues: IntentLoadIssue[]): string {
	return issues.map((issue) => `- ${issue.path}: ${issue.message}`).join("\n");
}

function resolveIntentPaths(rootDir: string, intentPaths?: string[]): string[] {
	if (intentPaths && intentPaths.length > 0) return intentPaths;
	const envPaths = parseIntentPaths(process.env[ENV_INTENT_PATHS]);
	if (envPaths.length > 0) return envPaths;

	const defaultPath = join(rootDir, DEFAULT_INTENT_DIR);
	if (existsSync(defaultPath)) return [DEFAULT_INTENT_DIR];

	return [];
}

function parseIntentPaths(value?: string): string[] {
	if (!value) return [];
	return value
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function collectIntentFiles(target: string, out: string[]): void {
	const stat = statSync(target);
	if (stat.isFile()) {
		out.push(target);
		return;
	}
	if (!stat.isDirectory()) return;

	let entries: string[] = [];
	try {
		entries = readdirSync(target);
	} catch {
		return;
	}

	for (const entry of entries) {
		const fullPath = join(target, entry);
		try {
			const entryStat = statSync(fullPath);
			if (entryStat.isDirectory()) {
				collectIntentFiles(fullPath, out);
			} else if (entryStat.isFile() && entry.endsWith(".intent.json")) {
				out.push(fullPath);
			}
		} catch {
			continue;
		}
	}
}

function buildIntentDefinition(doc: IntentDocument): IntentDefinition {
	const baseData = buildIntentData(doc);
	const profiles: Record<string, IntentData> = {
		[DEFAULT_INTENT_PROFILE]: baseData,
	};

	if (doc.profiles) {
		for (const [profileKey, overrides] of Object.entries(doc.profiles)) {
			profiles[profileKey] = mergeIntentData(baseData, overrides as IntentData);
		}
	}

	return {
		id: doc.id,
		profiles,
	};
}

function buildIntentData(doc: IntentDocument): IntentData {
	const data: IntentData = {
		title: doc.title,
		summary: doc.summary,
	};
	if (doc.status) data.status = doc.status;
	if (doc.audience) data.audience = doc.audience;
	if (doc.owners) data.owners = doc.owners;
	if (doc.goals) data.goals = doc.goals;
	if (doc.constraints) data.constraints = doc.constraints;
	if (doc.acceptance_criteria) data.acceptance_criteria = doc.acceptance_criteria;
	if (doc.references) data.references = doc.references;
	return data;
}

function mergeIntentData(base: IntentData, patch: IntentData): IntentData {
	const result: IntentData = structuredClone(base) as IntentData;
	for (const [key, value] of Object.entries(patch)) {
		const baseValue = (result as Record<string, unknown>)[key];
		if (isPlainObject(baseValue) && isPlainObject(value)) {
			(result as Record<string, unknown>)[key] = mergeIntentData(baseValue, value);
		} else {
			(result as Record<string, unknown>)[key] = value;
		}
	}
	return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
