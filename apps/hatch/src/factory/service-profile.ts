export interface ServiceProfile {
	service_tier: string;
	scheduler_weight: number;
	reserved_capacity: number;
	upgrade_channel: string;
	allowed_runtime_version: string;
	support_owner: string;
	feature_flags: Record<string, string>;
}

export const SERVICE_PROFILE_KEYS = [
	"service_tier",
	"scheduler_weight",
	"reserved_capacity",
	"upgrade_channel",
	"allowed_runtime_version",
	"support_owner",
	"feature_flags",
] as const;

export const defaultServiceProfile: ServiceProfile = Object.freeze({
	service_tier: "standard",
	scheduler_weight: 1,
	reserved_capacity: 0,
	upgrade_channel: "stable",
	allowed_runtime_version: "*",
	support_owner: "ops",
	feature_flags: {},
});

const SERVICE_PROFILE_TOKEN_PATTERN = /^[A-Za-z0-9-]+$/;
const RUNTIME_VERSION_RANGE_PATTERN = /^[0-9A-Za-z<>=~^!.*\s|+-]+$/;

interface ValidationIssue {
	path: string;
	message: string;
}

export function normalizeServiceProfile(partial: Partial<ServiceProfile> = {}): ServiceProfile {
	const featureFlagsSource = isPlainObject(partial.feature_flags)
		? partial.feature_flags
		: defaultServiceProfile.feature_flags;
	const feature_flags: Record<string, string> = {};
	for (const key of Object.keys(featureFlagsSource).sort((left, right) => left.localeCompare(right))) {
		const value = featureFlagsSource[key];
		if (typeof value === "string") {
			feature_flags[key] = value;
		}
	}

	return {
		service_tier: partial.service_tier ?? defaultServiceProfile.service_tier,
		scheduler_weight: partial.scheduler_weight ?? defaultServiceProfile.scheduler_weight,
		reserved_capacity: partial.reserved_capacity ?? defaultServiceProfile.reserved_capacity,
		upgrade_channel: partial.upgrade_channel ?? defaultServiceProfile.upgrade_channel,
		allowed_runtime_version: partial.allowed_runtime_version ?? defaultServiceProfile.allowed_runtime_version,
		support_owner: partial.support_owner ?? defaultServiceProfile.support_owner,
		feature_flags,
	};
}

export function validateServiceProfileFields(
	record: Record<string, unknown>,
	issues: ValidationIssue[],
	pathPrefix: string,
): void {
	validateTokenString(record, "service_tier", issues, `${pathPrefix}.service_tier`);
	validateInteger(record, "scheduler_weight", 1, issues, `${pathPrefix}.scheduler_weight`);
	validateInteger(record, "reserved_capacity", 0, issues, `${pathPrefix}.reserved_capacity`);
	validateTokenString(record, "upgrade_channel", issues, `${pathPrefix}.upgrade_channel`);
	validateRuntimeVersionRange(record, "allowed_runtime_version", issues, `${pathPrefix}.allowed_runtime_version`);
	optionalNonEmptyString(record, "support_owner", issues, `${pathPrefix}.support_owner`);
	validateFeatureFlags(record, issues, `${pathPrefix}.feature_flags`);
}

function validateTokenString(
	record: Record<string, unknown>,
	key: "service_tier" | "upgrade_channel",
	issues: ValidationIssue[],
	path: string,
): void {
	const value = record[key];
	if (value === undefined) return;
	if (typeof value !== "string" || value.trim() === "") {
		issues.push({ path, message: "must be a non-empty string" });
		return;
	}
	if (!SERVICE_PROFILE_TOKEN_PATTERN.test(value)) {
		issues.push({ path, message: "must match /^[A-Za-z0-9-]+$/" });
	}
}

function validateRuntimeVersionRange(
	record: Record<string, unknown>,
	key: "allowed_runtime_version",
	issues: ValidationIssue[],
	path: string,
): void {
	const value = record[key];
	if (value === undefined) return;
	if (typeof value !== "string" || value.trim() === "") {
		issues.push({ path, message: "must be a non-empty string" });
		return;
	}
	if (!RUNTIME_VERSION_RANGE_PATTERN.test(value)) {
		issues.push({
			path,
			message: "must be a semver range expression",
		});
	}
}

function validateInteger(
	record: Record<string, unknown>,
	key: "scheduler_weight" | "reserved_capacity",
	min: number,
	issues: ValidationIssue[],
	path: string,
): void {
	const value = record[key];
	if (value === undefined) return;
	if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
		issues.push({ path, message: `must be an integer >= ${min}` });
	}
}

function validateFeatureFlags(record: Record<string, unknown>, issues: ValidationIssue[], path: string): void {
	const value = record["feature_flags"];
	if (value === undefined) return;
	if (!isPlainObject(value)) {
		issues.push({ path, message: "must be an object map of string values" });
		return;
	}

	for (const [flagName, flagValue] of Object.entries(value)) {
		if (flagName.trim() === "") {
			issues.push({ path, message: "must only contain non-empty keys" });
			continue;
		}
		if (typeof flagValue !== "string" || flagValue.trim() === "") {
			issues.push({ path: `${path}.${flagName}`, message: "must be a non-empty string" });
		}
	}
}

function optionalNonEmptyString(
	record: Record<string, unknown>,
	key: "support_owner",
	issues: ValidationIssue[],
	path: string,
): void {
	const value = record[key];
	if (value === undefined) return;
	if (typeof value !== "string" || value.trim() === "") {
		issues.push({ path, message: "must be a non-empty string" });
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
