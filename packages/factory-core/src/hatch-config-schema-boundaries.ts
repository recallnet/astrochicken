import { createIssueList, defineBoundarySchema, z } from "./schema-registry.ts";

interface SchemaIssueRecord {
  path: string;
  message: string;
}

export const FACTORY_CONFIG_SCHEMA_VERSION = "hatch.factory.config.v1";
export const FACTORY_KIND_EXECUTION_MODES = ["issues_only", "code"];
export const FACTORY_INSTALLATION_WORKSPACE_MODES = ["api_only", "checkout", "worktree"];
const FACTORY_DEMO_POLICIES = ["auto", "terminal", "browser", "none"];

const nonEmptyStringSchema = z.string().trim().min(1);
const optionalStringArrayDocumentSchema = z.array(z.string()).optional();
const stringRecordSchema = z.record(z.string(), nonEmptyStringSchema);

const factoryDestinationRouteDocumentSchema = z.object({
	repo: nonEmptyStringSchema,
	labels: optionalStringArrayDocumentSchema,
}).catchall(z.unknown());

const factoryIsolationValueDocumentSchema = z.object({
	envVar: nonEmptyStringSchema.optional(),
	value: nonEmptyStringSchema.optional(),
}).catchall(z.unknown());

const factoryIsolationPathsDocumentSchema = z.object({
	runs: nonEmptyStringSchema.optional(),
	logs: nonEmptyStringSchema.optional(),
	tmp: nonEmptyStringSchema.optional(),
	cache: nonEmptyStringSchema.optional(),
}).catchall(z.unknown());

const factoryIsolationDocumentSchema = z.object({
	auth: z.object({
		github: z.object({
			tokenEnvVar: nonEmptyStringSchema.optional(),
			repo: nonEmptyStringSchema.optional(),
			factoryId: nonEmptyStringSchema.optional(),
		}).catchall(z.unknown()).optional(),
	}).catchall(z.unknown()).optional(),
	authStoragePath: nonEmptyStringSchema.optional(),
	model: factoryIsolationValueDocumentSchema.optional(),
	provider: factoryIsolationValueDocumentSchema.optional(),
	paths: factoryIsolationPathsDocumentSchema.optional(),
}).catchall(z.unknown());

export const factoryConfigDocumentSchema = z.object({
	schema: z.literal(FACTORY_CONFIG_SCHEMA_VERSION),
	factory_id: nonEmptyStringSchema,
	target_repo: nonEmptyStringSchema,
	control_plane_repo: nonEmptyStringSchema,
	dispatch: z.object({ graph: nonEmptyStringSchema }).catchall(z.unknown()),
	skills: z.object({ supervisor: nonEmptyStringSchema }).catchall(z.unknown()),
	scenarios: z.object({ root: nonEmptyStringSchema }).catchall(z.unknown()),
	pipeline: z.object({ supervisor_tick: nonEmptyStringSchema }).catchall(z.unknown()),
	conformance: z.object({
		entrypoint: nonEmptyStringSchema,
		fixtures: nonEmptyStringSchema.optional(),
		smoke_graph: nonEmptyStringSchema.optional(),
		runs_dir: nonEmptyStringSchema.optional(),
		benchmark_telemetry_warn_only: z.boolean().optional(),
		benchmark_telemetry_exemptions: optionalStringArrayDocumentSchema,
	}).catchall(z.unknown()).optional(),
	runs_dir: nonEmptyStringSchema,
	trust: z.object({
		domain: nonEmptyStringSchema,
		roles: z.array(z.string()).min(1),
	}).catchall(z.unknown()),
	isolation: factoryIsolationDocumentSchema.optional(),
	capabilities: z.object({
		goal_decomposition: z.object({
			timeouts: z.object({
				issue_draft: nonEmptyStringSchema.optional(),
				issue_repair: nonEmptyStringSchema.optional(),
				issue_judge: nonEmptyStringSchema.optional(),
				issue_revise: nonEmptyStringSchema.optional(),
			}).catchall(z.unknown()).optional(),
		}).catchall(z.unknown()).optional(),
		demo: z.object({
			policy: z.enum(FACTORY_DEMO_POLICIES).optional(),
		}).catchall(z.unknown()).optional(),
	}).catchall(z.unknown()).optional(),
	policyPack: z.unknown().optional(),
	managed: z.boolean().optional(),
	kind_id: nonEmptyStringSchema.optional(),
	instance_id: nonEmptyStringSchema.optional(),
	destinations: z.record(z.string(), factoryDestinationRouteDocumentSchema).optional(),
	upstream_repo: nonEmptyStringSchema.optional(),
	work_dir: nonEmptyStringSchema.optional(),
	upstream_bug_labels: optionalStringArrayDocumentSchema,
	slack_webhook_url: nonEmptyStringSchema.optional(),
	canonical_checkout_path: nonEmptyStringSchema.optional(),
	schedules: z.object({
		jobs: z.array(
			z.object({
				id: nonEmptyStringSchema,
				type: nonEmptyStringSchema,
				graph: nonEmptyStringSchema.optional(),
				cron: nonEmptyStringSchema,
				time_zone: nonEmptyStringSchema.optional(),
				enabled: z.boolean().optional(),
				catch_up: z.boolean().optional(),
				report_window_hours: z.number().optional(),
				repo: nonEmptyStringSchema.optional(),
				output_dir: nonEmptyStringSchema.optional(),
				notify_slack: z.boolean().optional(),
				issue_labels: optionalStringArrayDocumentSchema,
			}).catchall(z.unknown()),
		).min(1),
	}).catchall(z.unknown()).optional(),
}).catchall(z.unknown());

export const factoryKindDefinitionDocumentSchema = z.object({
	kind_id: nonEmptyStringSchema,
	schema_version: z.number().int().positive(),
	managed: z.boolean().optional(),
	execution_mode: z.enum(FACTORY_KIND_EXECUTION_MODES),
	shared_supervisor_shell: nonEmptyStringSchema,
	domain_graph: nonEmptyStringSchema,
	capabilities: z.array(
		z.object({
			id: nonEmptyStringSchema,
			channel: nonEmptyStringSchema,
		}).catchall(z.unknown()),
	).optional(),
	supported_destinations: optionalStringArrayDocumentSchema,
	required_labels: z.array(z.string()).min(1),
}).catchall(z.unknown());

export const factoryInstanceManifestDocumentSchema = z.object({
	instance_id: nonEmptyStringSchema,
	kind_id: nonEmptyStringSchema,
	target_repo: z.object({
		provider: nonEmptyStringSchema,
		repo_id: nonEmptyStringSchema,
		full_name: nonEmptyStringSchema,
	}).catchall(z.unknown()),
	control_plane_repo: nonEmptyStringSchema,
	intake: z.record(z.string(), z.unknown()).optional(),
	destinations: z.record(z.string(), factoryDestinationRouteDocumentSchema),
}).catchall(z.unknown());

export const factoryServiceRegistryDocumentSchema = z.object({
	instances: z.array(
		z.object({
			instance_id: nonEmptyStringSchema,
			kind_id: nonEmptyStringSchema,
			target_repo: nonEmptyStringSchema,
			status: nonEmptyStringSchema,
			assigned_host_id: nonEmptyStringSchema,
			service_tier: nonEmptyStringSchema.optional(),
			scheduler_weight: z.number().optional(),
			reserved_capacity: z.number().optional(),
			upgrade_channel: nonEmptyStringSchema.optional(),
			allowed_runtime_version: nonEmptyStringSchema.optional(),
			support_owner: nonEmptyStringSchema.optional(),
			feature_flags: stringRecordSchema.optional(),
		}).catchall(z.unknown()),
	),
}).catchall(z.unknown());

export const factoryInstallationManifestDocumentSchema = z.object({
	installation_id: nonEmptyStringSchema,
	instance_id: nonEmptyStringSchema,
	host_id: nonEmptyStringSchema,
	workspace_mode: z.enum(FACTORY_INSTALLATION_WORKSPACE_MODES),
	work_dir: z.union([nonEmptyStringSchema, z.null()]).optional(),
	log_dir: nonEmptyStringSchema.optional(),
}).catchall(z.unknown());

export const FACTORY_CONFIG_BOUNDARY_SCHEMA = defineBoundarySchema({
	id: "https://recallnet.dev/contracts/factory-config.json",
	version: FACTORY_CONFIG_SCHEMA_VERSION,
	title: "Factory Config Document",
	description: "Versioned Hatch factory configuration boundary for standalone and managed factories.",
	schema: factoryConfigDocumentSchema,
	sourcePath: "apps/hatch/src/factory/config-schema.ts",
	outputPath: "docs/contracts/factory-config.json",
	documentVersionField: "schema",
});

export const FACTORY_KIND_DEFINITION_BOUNDARY_SCHEMA = defineBoundarySchema({
	id: "https://recallnet.dev/contracts/factory-kind-definition.json",
	version: "factory_kind_definition/v1",
	title: "Factory Kind Definition",
	description: "Versioned managed factory kind definition document.",
	schema: factoryKindDefinitionDocumentSchema,
	sourcePath: "apps/hatch/src/factory/config-schema.ts",
	outputPath: "docs/contracts/factory-kind-definition.json",
});

export const FACTORY_INSTANCE_MANIFEST_BOUNDARY_SCHEMA = defineBoundarySchema({
	id: "https://recallnet.dev/contracts/factory-instance-manifest.json",
	version: "factory_instance_manifest/v1",
	title: "Factory Instance Manifest",
	description: "Versioned managed factory instance manifest document.",
	schema: factoryInstanceManifestDocumentSchema,
	sourcePath: "apps/hatch/src/factory/config-schema.ts",
	outputPath: "docs/contracts/factory-instance-manifest.json",
});

export const FACTORY_SERVICE_REGISTRY_BOUNDARY_SCHEMA = defineBoundarySchema({
	id: "https://recallnet.dev/contracts/factory-service-registry.json",
	version: "factory_service_registry/v1",
	title: "Factory Service Registry",
	description: "Versioned managed factory service registry document.",
	schema: factoryServiceRegistryDocumentSchema,
	sourcePath: "apps/hatch/src/factory/config-schema.ts",
	outputPath: "docs/contracts/factory-service-registry.json",
});

export const FACTORY_INSTALLATION_MANIFEST_BOUNDARY_SCHEMA = defineBoundarySchema({
	id: "https://recallnet.dev/contracts/factory-installation-manifest.json",
	version: "factory_installation_manifest/v1",
	title: "Factory Installation Manifest",
	description: "Versioned managed factory installation manifest document.",
	schema: factoryInstallationManifestDocumentSchema,
	sourcePath: "apps/hatch/src/factory/config-schema.ts",
	outputPath: "docs/contracts/factory-installation-manifest.json",
});

function pushUniqueIssue(issues: SchemaIssueRecord[], issue: SchemaIssueRecord): void {
	if (!issues.some((entry) => entry.path === issue.path && entry.message === issue.message)) {
		issues.push(issue);
	}
}

export function finalizeIssues(issues: SchemaIssueRecord[]): SchemaIssueRecord[] {
	return issues.filter((issue) => {
		if (
			issue.path === "work_dir"
			&& issue.message === "invalid value"
			&& issues.some((entry) => entry.path === "work_dir" && entry.message === "must be a non-empty string or null")
		) {
			return false;
		}
		if (
			issue.path === "schema"
			&& issue.message === "must be a non-empty string"
			&& issues.some((entry) => entry.path === "schema" && entry.message === `schema must be "${FACTORY_CONFIG_SCHEMA_VERSION}"`)
		) {
			return false;
		}
		if (
			issue.path === "capabilities.demo.policy"
			&& issue.message === "invalid value"
			&& issues.some((entry) => entry.path === "capabilities.demo.policy" && entry.message.startsWith("must be one of:"))
		) {
			return false;
		}
		return issues.findIndex((entry) => entry.path === issue.path && entry.message === issue.message) === issues.indexOf(issue);
	});
}

export function appendSchemaIssues(issues: SchemaIssueRecord[], error: import("zod/v4/core").$ZodError): void {
	for (const issue of createIssueList(error, (entry, path) => {
		const missing = entry.input === undefined || entry.input === null || (typeof entry.input === "string" && (entry.input as string).trim() === "");
		if ((entry as Record<string, unknown>).code === "unrecognized_keys") {
			return { path, message: `unknown key "${((entry as Record<string, unknown>).keys as string[])[0] ?? ""}"` };
		}
		if ((entry as Record<string, unknown>).code === "invalid_value" && path === "schema") {
			if (missing) return { path, message: "must be a non-empty string" };
			return { path, message: `schema must be "${FACTORY_CONFIG_SCHEMA_VERSION}"` };
		}
		if ((entry as Record<string, unknown>).code === "too_small" && typeof entry.input === "string") {
			if (path === "work_dir") return { path, message: "must be a non-empty string or null" };
			return { path, message: "must be a non-empty string" };
		}
		if ((entry as Record<string, unknown>).code === "too_small" && Array.isArray(entry.input)) return { path, message: "must be a non-empty array" };
		if ((entry as Record<string, unknown>).code === "invalid_type") {
			if ((entry as Record<string, unknown>).expected === "object") return { path, message: "must be an object" };
			if ((entry as Record<string, unknown>).expected === "array") return { path, message: "must be an array" };
			if ((entry as Record<string, unknown>).expected === "string") return { path, message: "must be a non-empty string" };
			if ((entry as Record<string, unknown>).expected === "boolean") return { path, message: "must be a boolean" };
			if ((entry as Record<string, unknown>).expected === "number") return { path, message: "must be a number" };
		}
		if ((entry as Record<string, unknown>).code === "invalid_value" && path === "capabilities.demo.policy") {
			return { path, message: `must be one of: ${FACTORY_DEMO_POLICIES.join(", ")}` };
		}
		if ((entry as Record<string, unknown>).code === "invalid_union" && path === "work_dir") {
			return { path, message: "must be a non-empty string or null" };
		}
		return { path, message: path ? "invalid value" : "invalid document" };
	})) {
		pushUniqueIssue(issues, issue);
	}
}
