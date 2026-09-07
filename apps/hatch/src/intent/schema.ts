import { defineBoundarySchema } from "@hatch/factory-core/schema-registry";
import { z } from "zod";
import type { $ZodIssue } from "zod/v4/core";

export const INTENT_SCHEMA_VERSION = "hatch.intent.v1" as const;

export interface IntentProfileDocument {
	audience?: string;
	goals?: string[];
	constraints?: string[];
	acceptance_criteria?: string[];
}

export interface IntentDocument {
	schema: typeof INTENT_SCHEMA_VERSION;
	id: string;
	title: string;
	summary: string;
	status?: string;
	audience?: string;
	owners?: string[];
	goals?: string[];
	constraints?: string[];
	acceptance_criteria?: string[];
	profiles?: Record<string, IntentProfileDocument>;
	references?: Record<string, string>;
}

export interface IntentSchemaIssue {
	path: string;
	message: string;
}

export class IntentSchemaError extends Error {
	constructor(public issues: IntentSchemaIssue[]) {
		super(formatIntentSchemaIssues(issues));
	}
}

const ROOT_KEYS = new Set([
	"schema",
	"id",
	"title",
	"summary",
	"status",
	"audience",
	"owners",
	"goals",
	"constraints",
	"acceptance_criteria",
	"profiles",
	"references",
]);

function requiredNonEmptyStringSchema() {
	return z.string().trim().min(1);
}

function optionalStringArraySchema() {
	return z.array(z.string()).optional();
}

const intentProfileSchema = z
	.object({
		audience: z.string().optional(),
		goals: optionalStringArraySchema(),
		constraints: optionalStringArraySchema(),
		acceptance_criteria: optionalStringArraySchema(),
	})
	.strict();

export const intentDocumentSchema = z
	.object({
		schema: z.literal(INTENT_SCHEMA_VERSION),
		id: requiredNonEmptyStringSchema(),
		title: requiredNonEmptyStringSchema(),
		summary: requiredNonEmptyStringSchema(),
		status: z.string().optional(),
		audience: z.string().optional(),
		owners: optionalStringArraySchema(),
		goals: optionalStringArraySchema(),
		constraints: optionalStringArraySchema(),
		acceptance_criteria: optionalStringArraySchema(),
		profiles: z.record(z.string(), intentProfileSchema).optional(),
		references: z.record(z.string(), z.string()).optional(),
	})
	.strict();

export const INTENT_BOUNDARY_SCHEMA = defineBoundarySchema({
	id: "https://recallnet.dev/contracts/hatch-intent.json",
	version: INTENT_SCHEMA_VERSION,
	title: "Hatch Intent Document",
	description: "Versioned intent registry entry consumed by Hatch runtime intent loading.",
	schema: intentDocumentSchema,
	sourcePath: "apps/hatch/src/intent/schema.ts",
	outputPath: "docs/contracts/hatch-intent.json",
});

export function validateIntentDocument(value: unknown): IntentSchemaIssue[] {
	if (!isPlainObject(value)) {
		return [{ path: "", message: "intent document must be an object" }];
	}

	const issues: IntentSchemaIssue[] = [];
	const doc = value as Record<string, unknown>;

	for (const key of Object.keys(doc)) {
		if (!ROOT_KEYS.has(key)) {
			issues.push({ path: key, message: `unknown key "${key}"` });
		}
	}

	const result = intentDocumentSchema.safeParse(doc);
	if (result.success) {
		return issues;
	}

	for (const issue of result.error.issues) {
		if (issue.code === "unrecognized_keys") {
			for (const key of issue.keys) {
				const prefix = formatPath(issue.path);
				issues.push({
					path: prefix ? `${prefix}.${key}` : key,
					message: `unknown key "${key}"`,
				});
			}
			continue;
		}
		const path = formatPath(issue.path);
		issues.push(mapIntentIssue(issue, path));
	}

	return issues;
}

export function parseIntentDocument(value: unknown): IntentDocument {
	const issues = validateIntentDocument(value);
	if (issues.length > 0) {
		throw new IntentSchemaError(issues);
	}
	return value as IntentDocument;
}

export function formatIntentSchemaIssues(issues: IntentSchemaIssue[]): string {
	return issues.map((issue) => `- ${issue.path || "(root)"}: ${issue.message}`).join("\n");
}

function mapIntentIssue(issue: $ZodIssue, path: string): IntentSchemaIssue {
	if (path === "schema") {
		return {
			path,
			message: `schema must be "${INTENT_SCHEMA_VERSION}"`,
		};
	}

	if (issue.code === "invalid_type") {
		if (path === "references") {
			return { path, message: "must be an object of string values" };
		}
		if (path === "profiles") {
			return { path, message: "must be an object of profile definitions" };
		}
		if (path.startsWith("profiles.") && countPathSegments(path) === 2) {
			return { path, message: "profile must be an object" };
		}
		if (path.includes("[") && lastPathSegment(path).startsWith("[")) {
			return { path, message: "must be a string" };
		}
		return { path, message: "must be a string" };
	}

	if (issue.code === "invalid_value" && path === "schema") {
		return { path, message: `schema must be "${INTENT_SCHEMA_VERSION}"` };
	}

	if (issue.code === "too_small") {
		return { path, message: "must be a non-empty string" };
	}

	return {
		path,
		message: issue.message,
	};
}

function formatPath(path: PropertyKey[]): string {
	let out = "";
	for (const part of path) {
		if (typeof part === "number") {
			out += `[${part}]`;
			continue;
		}
		out += out ? `.${String(part)}` : String(part);
	}
	return out;
}

function countPathSegments(path: string): number {
	return path.split(".").filter(Boolean).length;
}

function lastPathSegment(path: string): string {
	const parts = path.split(".");
	return parts[parts.length - 1] ?? "";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
