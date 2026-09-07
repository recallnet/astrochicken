import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface PolicyPackIssue {
	path: string;
	message: string;
}

export interface FactoryPolicyPackConfigDocument {
	version: string;
	overrides?: Record<string, unknown>;
}

export interface PolicyPackMetadataDocument {
	version: string;
	owned_by: string;
	files: Record<string, string>;
	required_keys: Record<string, string[]>;
	customizable_keys: Record<string, string[]>;
}

export interface PolicyPackDocuments {
	metadata: PolicyPackMetadataDocument;
	policies: Record<string, unknown>;
}

export interface ValidatePolicyPackContractArgs {
	policyPack: FactoryPolicyPackConfigDocument;
	metadata: PolicyPackMetadataDocument;
	policies: Record<string, unknown>;
}

export function loadPolicyPackDocuments(policyPackDir: string): PolicyPackDocuments {
	const metadataPath = join(policyPackDir, "metadata.json");
	const metadataRaw = parseJsonDocument(metadataPath);
	const metadataIssues = validatePolicyPackMetadata(metadataRaw);
	if (metadataIssues.length > 0) {
		throw new Error(`metadata.json invalid: ${formatPolicyPackIssue(metadataIssues[0])}`);
	}
	const metadata = metadataRaw as PolicyPackMetadataDocument;
	const policies: Record<string, unknown> = {};

	for (const [policyName, relativePath] of Object.entries(metadata.files)) {
		policies[policyName] = parseJsonDocument(join(policyPackDir, relativePath));
	}

	return { metadata, policies };
}

export function validatePolicyPackContract({
	policyPack,
	metadata,
	policies,
}: ValidatePolicyPackContractArgs): PolicyPackIssue[] {
	const issues: PolicyPackIssue[] = [];

	if (policyPack.version !== metadata.version) {
		issues.push({
			path: "policyPack.version",
			message: `policyPack.version mismatch (expected \"${metadata.version}\", got \"${policyPack.version}\")`,
		});
	}

	for (const [policyName, requiredPaths] of Object.entries(metadata.required_keys)) {
		const policyDoc = asObject(policies[policyName]);
		if (!policyDoc) {
			issues.push({
				path: `policyPack.${policyName}`,
				message: "required policy file is missing or not an object",
			});
			continue;
		}

		for (const requiredPath of requiredPaths) {
			const value = getPathValue(policyDoc, requiredPath);
			if (value === undefined) {
				issues.push({
					path: `policyPack.${policyName}`,
					message: `required key missing: \"${requiredPath}\"`,
				});
			}
		}
	}

	const overridePolicies = asObject(policyPack.overrides) ?? {};
	for (const [policyName, overrideValue] of Object.entries(overridePolicies)) {
		const overrideDoc = asObject(overrideValue);
		if (!overrideDoc) {
			issues.push({
				path: `policyPack.overrides.${policyName}`,
				message: "must be an object",
			});
			continue;
		}

		const allowedKeys = new Set(metadata.customizable_keys[policyName] ?? []);
		const overridePaths = flattenLeafPaths(overrideDoc);
		for (const overridePath of overridePaths) {
			if (allowedKeys.has(overridePath)) continue;
			issues.push({
				path: `policyPack.${policyName}`,
				message: `overrides forbidden key: \"${overridePath}\"`,
			});
		}
	}

	return issues;
}

export function validatePolicyPackMetadata(value: unknown): PolicyPackIssue[] {
	const issues: PolicyPackIssue[] = [];
	const metadata = asObject(value);
	if (!metadata) {
		issues.push({ path: "policyPack.metadata", message: "must be an object" });
		return issues;
	}

	const version = metadata["version"];
	if (typeof version !== "string" || version.trim() === "") {
		issues.push({ path: "policyPack.metadata.version", message: "must be a non-empty string" });
	}

	const ownedBy = metadata["owned_by"];
	if (typeof ownedBy !== "string" || ownedBy.trim() === "") {
		issues.push({ path: "policyPack.metadata.owned_by", message: "must be a non-empty string" });
	}

	validateStringMap(metadata["files"], "policyPack.metadata.files", issues);
	validateStringArrayMap(metadata["required_keys"], "policyPack.metadata.required_keys", issues);
	validateStringArrayMap(metadata["customizable_keys"], "policyPack.metadata.customizable_keys", issues);

	return issues;
}

export function formatPolicyPackIssue(issue: PolicyPackIssue): string {
	return `${issue.path || "(root)"}: ${issue.message}`;
}

function parseJsonDocument(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function getPathValue(value: Record<string, unknown>, dottedPath: string): unknown {
	const segments = dottedPath.split(".");
	let cursor: unknown = value;
	for (const segment of segments) {
		const cursorObject = asObject(cursor);
		if (!cursorObject || !(segment in cursorObject)) {
			return undefined;
		}
		cursor = cursorObject[segment];
	}
	return cursor;
}

function flattenLeafPaths(value: Record<string, unknown>, prefix = ""): string[] {
	const paths: string[] = [];
	for (const [key, child] of Object.entries(value)) {
		const next = prefix ? `${prefix}.${key}` : key;
		const childObject = asObject(child);
		if (childObject) {
			paths.push(...flattenLeafPaths(childObject, next));
			continue;
		}
		paths.push(next);
	}
	return paths;
}

function validateStringMap(value: unknown, pathPrefix: string, issues: PolicyPackIssue[]): void {
	const map = asObject(value);
	if (!map) {
		issues.push({ path: pathPrefix, message: "must be an object" });
		return;
	}
	for (const [key, entry] of Object.entries(map)) {
		if (typeof entry !== "string" || entry.trim() === "") {
			issues.push({ path: `${pathPrefix}.${key}`, message: "must be a non-empty string" });
		}
	}
}

function validateStringArrayMap(value: unknown, pathPrefix: string, issues: PolicyPackIssue[]): void {
	const map = asObject(value);
	if (!map) {
		issues.push({ path: pathPrefix, message: "must be an object" });
		return;
	}
	for (const [key, entry] of Object.entries(map)) {
		if (!Array.isArray(entry) || entry.length === 0) {
			issues.push({ path: `${pathPrefix}.${key}`, message: "must be a non-empty array" });
			continue;
		}
		for (let index = 0; index < entry.length; index++) {
			const valueAtIndex = entry[index];
			if (typeof valueAtIndex !== "string" || valueAtIndex.trim() === "") {
				issues.push({
					path: `${pathPrefix}.${key}[${index}]`,
					message: "must be a non-empty string",
				});
			}
		}
	}
}

function asObject(value: unknown): Record<string, unknown> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined;
	}
	return value as Record<string, unknown>;
}
