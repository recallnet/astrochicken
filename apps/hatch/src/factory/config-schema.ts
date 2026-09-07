import path from "node:path";
import {
	appendSchemaIssues,
	FACTORY_CONFIG_BOUNDARY_SCHEMA,
	FACTORY_CONFIG_SCHEMA_VERSION,
	FACTORY_INSTALLATION_MANIFEST_BOUNDARY_SCHEMA,
	FACTORY_INSTALLATION_WORKSPACE_MODES,
	FACTORY_INSTANCE_MANIFEST_BOUNDARY_SCHEMA,
	FACTORY_KIND_DEFINITION_BOUNDARY_SCHEMA,
	FACTORY_KIND_EXECUTION_MODES,
	FACTORY_SERVICE_REGISTRY_BOUNDARY_SCHEMA,
	factoryConfigDocumentSchema,
	factoryInstallationManifestDocumentSchema,
	factoryInstanceManifestDocumentSchema,
	factoryKindDefinitionDocumentSchema,
	factoryServiceRegistryDocumentSchema,
	finalizeIssues,
} from "@hatch/factory-core/hatch-config-schema-boundaries";
import { GOAL_DECOMPOSITION_TIMEOUT_STAGES } from "./goal-decomposition-timeouts.js";
import { usesReservedMothershipScenarioLeaf } from "./scenario-root-contract.js";
import { SERVICE_PROFILE_KEYS, validateServiceProfileFields } from "./service-profile.js";
import type { FactoryPolicyPackConfigDocument } from "./policy-pack.js";
export {
	GOAL_DECOMPOSITION_TIMEOUT_DEFAULTS,
	GOAL_DECOMPOSITION_TIMEOUT_OVERRIDES_ROOT_KEY_PATH,
	GOAL_DECOMPOSITION_TIMEOUT_STAGES,
	resolveGoalDecompositionTimeouts,
	type GoalDecompositionTimeoutResolution,
	type GoalDecompositionTimeoutStage,
} from "./goal-decomposition-timeouts.js";
export {
	formatPolicyPackIssue,
	loadPolicyPackDocuments,
	validatePolicyPackContract,
	type FactoryPolicyPackConfigDocument,
	type PolicyPackDocuments,
	type PolicyPackIssue,
	type PolicyPackMetadataDocument,
} from "./policy-pack.js";
const FACTORY_ID_PATTERN = /^[a-z0-9-]+$/;
const OWNER_REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export { FACTORY_CONFIG_BOUNDARY_SCHEMA, FACTORY_CONFIG_SCHEMA_VERSION };
export { FACTORY_INSTALLATION_MANIFEST_BOUNDARY_SCHEMA, FACTORY_INSTALLATION_WORKSPACE_MODES };
export { FACTORY_INSTANCE_MANIFEST_BOUNDARY_SCHEMA };
export { FACTORY_KIND_DEFINITION_BOUNDARY_SCHEMA, FACTORY_KIND_EXECUTION_MODES };
export { FACTORY_SERVICE_REGISTRY_BOUNDARY_SCHEMA };
export type FactoryKindExecutionMode = (typeof FACTORY_KIND_EXECUTION_MODES)[number];
export type FactoryInstallationWorkspaceMode = (typeof FACTORY_INSTALLATION_WORKSPACE_MODES)[number];
export interface FactoryConfigIssue {
	path: string;
	message: string;
}
export interface FactoryKindCapabilityDocument {
	id: string;
	channel: string;
}
export interface FactoryKindDefinitionDocument {
	kind_id: string;
	schema_version: number;
	managed?: boolean;
	execution_mode: FactoryKindExecutionMode;
	shared_supervisor_shell: string;
	domain_graph: string;
	capabilities?: FactoryKindCapabilityDocument[];
	supported_destinations?: string[];
	required_labels: string[];
	[key: string]: unknown;
}
export interface FactoryInstanceTargetRepoDocument {
	provider: string;
	repo_id: string;
	full_name: string;
}
export interface FactoryDestinationRouteDocument {
	repo: string;
	labels?: string[];
	[key: string]: unknown;
}
export interface FactoryInstanceManifestDocument {
	instance_id: string;
	kind_id: string;
	target_repo: FactoryInstanceTargetRepoDocument;
	control_plane_repo: string;
	intake?: Record<string, unknown>;
	destinations: Record<string, FactoryDestinationRouteDocument>;
	[key: string]: unknown;
}
export interface FactoryServiceRegistryInstanceRecordDocument {
	instance_id: string;
	kind_id: string;
	target_repo: string;
	control_plane_repo: string;
	status: string;
	assigned_host_id: string;
	service_tier?: string;
	scheduler_weight?: number;
	reserved_capacity?: number;
	upgrade_channel?: string;
	allowed_runtime_version?: string;
	support_owner?: string;
	feature_flags?: Record<string, string>;
	[key: string]: unknown;
}
export interface FactoryServiceRegistryDocument {
	instances: FactoryServiceRegistryInstanceRecordDocument[];
	[key: string]: unknown;
}
export interface FactoryInstallationManifestDocument {
	installation_id: string;
	instance_id: string;
	host_id: string;
	workspace_mode: FactoryInstallationWorkspaceMode;
	work_dir?: string | null;
	log_dir?: string;
	[key: string]: unknown;
}
export interface FactoryConfigDispatchDocument {
	graph: string;
	latency_slo_seconds?: number;
}
export interface FactoryConfigSkillsDocument {
	supervisor: string;
}
export interface FactoryConfigScenariosDocument {
	root: string;
}
export interface FactoryConfigPipelineDocument {
	supervisor_tick: string;
	maintenance_interval_seconds?: number;
}
export interface FactoryConfigConformanceDocument {
	entrypoint: string;
	fixtures?: string;
	smoke_graph?: string;
	runs_dir?: string;
	benchmark_telemetry_warn_only?: boolean;
	benchmark_telemetry_exemptions?: string[];
}
export interface FactoryConfigTrustDocument {
	domain: string;
	roles: string[];
}
export interface FactoryIsolationAuthGithubDocument {
	tokenEnvVar?: string;
	repo?: string;
	factoryId?: string;
}
export interface FactoryIsolationAuthDocument {
	github?: FactoryIsolationAuthGithubDocument;
}
export interface FactoryIsolationValueDocument {
	envVar?: string;
	value?: string;
}
export interface FactoryIsolationPathsDocument {
	runs?: string;
	logs?: string;
	tmp?: string;
	cache?: string;
}
export interface FactoryIsolationDocument {
	auth?: FactoryIsolationAuthDocument;
	authStoragePath?: string;
	model?: FactoryIsolationValueDocument;
	provider?: FactoryIsolationValueDocument;
	paths?: FactoryIsolationPathsDocument;
}
export interface FactoryConfigGoalDecompositionTimeoutsDocument { issue_draft?: string; issue_repair?: string; issue_judge?: string; issue_revise?: string }
const FACTORY_CONFIG_DEMO_POLICIES = ["auto", "terminal", "browser", "none"] as const;
export type FactoryConfigDemoPolicy = (typeof FACTORY_CONFIG_DEMO_POLICIES)[number];
export interface FactoryConfigGoalDecompositionDocument { timeouts?: FactoryConfigGoalDecompositionTimeoutsDocument }
export interface FactoryConfigDemoDocument { policy?: FactoryConfigDemoPolicy }
export interface FactoryConfigCapabilitiesDocument { goal_decomposition?: FactoryConfigGoalDecompositionDocument; demo?: FactoryConfigDemoDocument }
export interface FactoryConfigScheduleJobDocument {
	id: string;
	type: string;
	cron: string;
	time_zone?: string;
	enabled?: boolean;
	catch_up?: boolean;
	report_window_hours?: number;
	repo?: string;
	output_dir?: string;
	notify_slack?: boolean;
	issue_labels?: string[];
}
export interface FactoryConfigSchedulesDocument {
	jobs: FactoryConfigScheduleJobDocument[];
}
export interface FactoryConfigDocument {
	schema: typeof FACTORY_CONFIG_SCHEMA_VERSION;
	factory_id: string;
	target_repo: string;
	control_plane_repo: string;
	dispatch: FactoryConfigDispatchDocument;
	skills: FactoryConfigSkillsDocument;
	scenarios: FactoryConfigScenariosDocument;
	pipeline: FactoryConfigPipelineDocument;
	conformance?: FactoryConfigConformanceDocument;
	runs_dir: string;
	trust: FactoryConfigTrustDocument;
	isolation?: FactoryIsolationDocument;
	capabilities?: FactoryConfigCapabilitiesDocument;
	policyPack?: FactoryPolicyPackConfigDocument;
	managed?: boolean;
	kind_id?: string;
	instance_id?: string;
	destinations?: Record<string, FactoryDestinationRouteDocument>;
	upstream_repo?: string;
	work_dir?: string;
	upstream_bug_labels?: string[];
	slack_webhook_url?: string;
	canonical_checkout_path?: string;
	schedules?: FactoryConfigSchedulesDocument;
	[key: string]: unknown;
}
export interface FactoryIsolationAuthGithubConfig {
	tokenEnvVar?: string;
	repo: string;
	factoryId?: string;
}
export interface FactoryIsolationAuthConfig {
	github?: FactoryIsolationAuthGithubConfig;
}
export interface FactoryIsolationValueConfig {
	envVar?: string;
	value?: string;
}
export interface FactoryIsolationPathsConfig {
	runs?: string;
	logs?: string;
	tmp?: string;
	cache?: string;
}
export interface FactoryIsolationConfig {
	auth?: FactoryIsolationAuthConfig;
	authStoragePath?: string;
	model?: FactoryIsolationValueConfig;
	provider?: FactoryIsolationValueConfig;
	paths?: FactoryIsolationPathsConfig;
}
export interface FactoryRuntimePathDefaults {
	runs: string;
	logs?: string;
	tmp?: string;
	cache?: string;
	baseDir?: string;
}
export interface FactoryRuntimePaths {
	runs: string;
	logs: string;
	tmp: string;
	cache: string;
}
export interface AssertFactoryIsolationContextArgs {
	isolationConfig?: FactoryIsolationConfig;
	factoryId?: string;
	targetRepo?: string;
	env?: Record<string, string | undefined>;
}
export function validateFactoryConfigDocument(value: unknown): FactoryConfigIssue[] {
	const issues: FactoryConfigIssue[] = [];
	if (!isPlainObject(value)) {
		issues.push({ path: "", message: "factory config must be an object" });
		return issues;
	}

	const doc = value as Record<string, unknown>;
	const schemaResult = factoryConfigDocumentSchema.safeParse(doc);
	if (!schemaResult.success) {
		appendSchemaIssues(issues, schemaResult.error);
	}
	const schema = requireString(doc, "schema", issues);
	if (schema && schema !== FACTORY_CONFIG_SCHEMA_VERSION) {
		issues.push({
			path: "schema",
			message: `schema must be "${FACTORY_CONFIG_SCHEMA_VERSION}"`,
		});
	}

	const factoryId = requireString(doc, "factory_id", issues);
	if (factoryId && !FACTORY_ID_PATTERN.test(factoryId)) {
		issues.push({ path: "factory_id", message: "must match /^[a-z0-9-]+$/" });
	}

	validateOwnerRepoField(doc, "target_repo", issues);
	validateOwnerRepoField(doc, "control_plane_repo", issues);
	const runsDir = requireString(doc, "runs_dir", issues);
	if (runsDir !== undefined && runsDir.trim() === "") {
		issues.push({ path: "runs_dir", message: "must be a non-empty string" });
	}

	if ("repo" in doc) {
		issues.push({
			path: "repo",
			message: "unsupported legacy key; use target_repo",
		});
	}
	if ("control_plane" in doc) {
		issues.push({
			path: "control_plane",
			message: "unsupported legacy key; use control_plane_repo",
		});
	}
	if ("goal_decomposition" in doc) {
		issues.push({
			path: "goal_decomposition",
			message: "unsupported legacy key; use capabilities.goal_decomposition",
		});
	}
	if ("demo_strategy" in doc) {
		issues.push({
			path: "demo_strategy",
			message: "unsupported legacy key; use capabilities.demo.policy",
		});
	}

	const dispatch = requireObject(doc, "dispatch", issues);
	const dispatchGraph = dispatch ? requireString(dispatch, "graph", issues, "dispatch.graph") : undefined;
	if (dispatch) {
		optionalPositiveInteger(dispatch, "latency_slo_seconds", issues, "dispatch.latency_slo_seconds");
	}

	const skills = requireObject(doc, "skills", issues);
	if (skills) {
		requireString(skills, "supervisor", issues, "skills.supervisor");
	}

	const scenarios = requireObject(doc, "scenarios", issues);
	if (scenarios) {
		const scenariosRoot = requireString(scenarios, "root", issues, "scenarios.root");
		if (
			usesReservedMothershipScenarioLeaf({
				factoryId,
				scenariosRoot,
			})
		) {
			issues.push({
				path: "scenarios.root",
				message: 'non-mothership factories must not use an "astrochicken" scenario root leaf',
			});
		}
	}

	const pipeline = requireObject(doc, "pipeline", issues);
	const supervisorTick = pipeline ? requireString(pipeline, "supervisor_tick", issues, "pipeline.supervisor_tick") : undefined;
	if (pipeline) {
		optionalPositiveInteger(pipeline, "maintenance_interval_seconds", issues, "pipeline.maintenance_interval_seconds");
	}

	if (doc["conformance"] !== undefined) {
		const conformance = requireObject(doc, "conformance", issues);
		if (conformance) {
			requireString(conformance, "entrypoint", issues, "conformance.entrypoint");
			optionalString(conformance, "fixtures", issues, "conformance.fixtures");
			optionalString(conformance, "smoke_graph", issues, "conformance.smoke_graph");
			optionalString(conformance, "runs_dir", issues, "conformance.runs_dir");
			optionalBoolean(conformance, "benchmark_telemetry_warn_only", issues, "conformance.benchmark_telemetry_warn_only");
			optionalStringArray(conformance, "benchmark_telemetry_exemptions", issues, "conformance.benchmark_telemetry_exemptions");
		}
	}

	const trust = requireObject(doc, "trust", issues);
	if (trust) {
		const trustDomain = requireString(trust, "domain", issues, "trust.domain");
		const roles = trust["roles"];
		if (!Array.isArray(roles) || roles.length === 0) {
			issues.push({ path: "trust.roles", message: "must be a non-empty array" });
		} else {
			for (let index = 0; index < roles.length; index++) {
				const roleValue = roles[index];
				if (typeof roleValue !== "string" || roleValue.trim() === "") {
					issues.push({ path: `trust.roles[${index}]`, message: "must be a non-empty string" });
					continue;
				}
				if (trustDomain && !roleValue.startsWith(`${trustDomain}.`)) {
					issues.push({
						path: `trust.roles[${index}]`,
						message: `must start with "${trustDomain}."`,
					});
				}
			}
		}
	}

	if (doc["isolation"] !== undefined) {
		validateIsolationDocument(doc["isolation"], issues, "isolation");
	}

	if (doc["capabilities"] !== undefined) {
		validateCapabilitiesDocument(doc["capabilities"], issues, "capabilities");
	}

	if (doc["policyPack"] !== undefined) {
		validatePolicyPackDocument(doc["policyPack"], issues, "policyPack");
	}

	// Managed factory fields
	if (doc["managed"] !== undefined) {
		optionalBoolean(doc, "managed", issues, "managed");
	}
	if (doc["kind_id"] !== undefined) {
		const kindId = optionalString(doc, "kind_id", issues, "kind_id");
		if (kindId && !FACTORY_ID_PATTERN.test(kindId)) {
			issues.push({ path: "kind_id", message: "must match /^[a-z0-9-]+$/" });
		}
	}
	if (doc["instance_id"] !== undefined) {
		optionalString(doc, "instance_id", issues, "instance_id");
	}
	if (doc["destinations"] !== undefined) {
		const destinations = optionalObject(doc, "destinations", issues, "destinations");
		if (destinations) {
			for (const [routeName, routeValue] of Object.entries(destinations)) {
				const routePath = `destinations.${routeName}`;
				if (!routeName.trim()) {
					issues.push({ path: "destinations", message: "destination route keys must be non-empty strings" });
					continue;
				}
				if (!isPlainObject(routeValue)) {
					issues.push({ path: routePath, message: "must be an object" });
					continue;
				}
				const routeRepo = requireString(routeValue, "repo", issues, `${routePath}.repo`);
				if (routeRepo && !OWNER_REPO_PATTERN.test(routeRepo)) {
					issues.push({ path: `${routePath}.repo`, message: "must be owner/repo" });
				}
				optionalStringArray(routeValue, "labels", issues, `${routePath}.labels`);
			}
		}
	}
	if (doc["upstream_repo"] !== undefined) {
		validateOwnerRepoField(doc, "upstream_repo", issues);
	}
	if (doc["work_dir"] !== undefined) {
		const workDir = doc["work_dir"];
		if (typeof workDir !== "string" || workDir.trim() === "") {
			issues.push({ path: "work_dir", message: "must be a non-empty string" });
		}
	}
	if (doc["upstream_bug_labels"] !== undefined) {
		optionalStringArray(doc, "upstream_bug_labels", issues, "upstream_bug_labels");
	}
	if (doc["slack_webhook_url"] !== undefined) {
		optionalString(doc, "slack_webhook_url", issues, "slack_webhook_url");
	}
	if (doc["canonical_checkout_path"] !== undefined) {
		optionalString(doc, "canonical_checkout_path", issues, "canonical_checkout_path");
	}
	if (doc["schedules"] !== undefined) {
		const schedules = optionalObject(doc, "schedules", issues, "schedules");
		if (schedules) {
			const jobs = schedules["jobs"];
			if (!Array.isArray(jobs) || jobs.length === 0) {
				issues.push({ path: "schedules.jobs", message: "must be a non-empty array" });
			} else {
				for (let index = 0; index < jobs.length; index++) {
					const job = jobs[index];
					const jobPath = `schedules.jobs[${index}]`;
					if (!isPlainObject(job)) {
						issues.push({ path: jobPath, message: "must be an object" });
						continue;
					}
					requireString(job, "id", issues, `${jobPath}.id`);
					requireString(job, "type", issues, `${jobPath}.type`);
					requireString(job, "cron", issues, `${jobPath}.cron`);
					const jobType = optionalString(job, "type", issues, `${jobPath}.type`);
					if (jobType === "graph") {
						requireString(job, "graph", issues, `${jobPath}.graph`);
						if (!String(job["graph"] ?? "").trim()) {
							issues.push({ path: `${jobPath}.graph`, message: "must be a non-empty string when type=graph" });
						}
					}
					optionalString(job, "time_zone", issues, `${jobPath}.time_zone`);
					optionalBoolean(job, "enabled", issues, `${jobPath}.enabled`);
					optionalBoolean(job, "catch_up", issues, `${jobPath}.catch_up`);
					optionalNumber(job, "report_window_hours", issues, `${jobPath}.report_window_hours`);
					if (job["repo"] !== undefined) {
						const repo = optionalString(job, "repo", issues, `${jobPath}.repo`);
						if (repo && !OWNER_REPO_PATTERN.test(repo)) {
							issues.push({ path: `${jobPath}.repo`, message: "must be owner/repo" });
						}
					}
					optionalString(job, "output_dir", issues, `${jobPath}.output_dir`);
					optionalBoolean(job, "notify_slack", issues, `${jobPath}.notify_slack`);
					optionalStringArray(job, "issue_labels", issues, `${jobPath}.issue_labels`);
				}
			}
		}
	}
	// Cross-field invariant: managed=true requires upstream_repo
	if (doc["managed"] === true && !doc["upstream_repo"]) {
		issues.push({
			path: "upstream_repo",
			message: "required when managed is true",
		});
	}

	return finalizeIssues(issues);
}

export function parseFactoryConfigDocument(value: unknown): FactoryConfigDocument {
	const issues = validateFactoryConfigDocument(value);
	if (issues.length > 0) {
		throw new Error(formatFactoryConfigIssue(issues[0]));
	}
	return value as FactoryConfigDocument;
}

export function validateFactoryKindDefinitionDocument(value: unknown): FactoryConfigIssue[] {
	const issues: FactoryConfigIssue[] = [];
	if (!isPlainObject(value)) {
		issues.push({ path: "", message: "factory kind definition must be an object" });
		return issues;
	}

	const doc = value as Record<string, unknown>;
	const schemaResult = factoryKindDefinitionDocumentSchema.safeParse(doc);
	if (!schemaResult.success) {
		appendSchemaIssues(issues, schemaResult.error);
	}
	const kindId = requireString(doc, "kind_id", issues);
	if (kindId && !FACTORY_ID_PATTERN.test(kindId)) {
		issues.push({ path: "kind_id", message: "must match /^[a-z0-9-]+$/" });
	}

	const schemaVersion = doc["schema_version"];
	if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion) || schemaVersion <= 0) {
		issues.push({ path: "schema_version", message: "must be a positive integer" });
	}

	if (doc["managed"] !== undefined) {
		optionalBoolean(doc, "managed", issues, "managed");
	}

	const executionMode = requireString(doc, "execution_mode", issues);
	if (executionMode && !FACTORY_KIND_EXECUTION_MODES.includes(executionMode as FactoryKindExecutionMode)) {
		issues.push({
			path: "execution_mode",
			message: `must be one of: ${FACTORY_KIND_EXECUTION_MODES.join(", ")}`,
		});
	}

	requireString(doc, "shared_supervisor_shell", issues);
	requireString(doc, "domain_graph", issues);

	const requiredLabels = doc["required_labels"];
	if (!Array.isArray(requiredLabels) || requiredLabels.length === 0) {
		issues.push({ path: "required_labels", message: "must be a non-empty array of non-empty strings" });
	} else {
		for (let index = 0; index < requiredLabels.length; index += 1) {
			const label = requiredLabels[index];
			if (typeof label !== "string" || label.trim() === "") {
				issues.push({ path: `required_labels[${index}]`, message: "must be a non-empty string" });
			}
		}
	}

	optionalStringArray(doc, "supported_destinations", issues, "supported_destinations");

	if (doc["capabilities"] !== undefined) {
		const capabilities = doc["capabilities"];
		if (!Array.isArray(capabilities)) {
			issues.push({ path: "capabilities", message: "must be an array" });
		} else {
			for (let index = 0; index < capabilities.length; index += 1) {
				const capability = capabilities[index];
				const capabilityPath = `capabilities[${index}]`;
				if (!isPlainObject(capability)) {
					issues.push({ path: capabilityPath, message: "must be an object" });
					continue;
				}
				requireString(capability, "id", issues, `${capabilityPath}.id`);
				requireString(capability, "channel", issues, `${capabilityPath}.channel`);
			}
		}
	}

	return finalizeIssues(issues);
}

export function parseFactoryKindDefinitionDocument(value: unknown): FactoryKindDefinitionDocument {
	const issues = validateFactoryKindDefinitionDocument(value);
	if (issues.length > 0) {
		throw new Error(formatFactoryConfigIssue(issues[0]));
	}
	return value as FactoryKindDefinitionDocument;
}

export function validateFactoryInstanceManifestDocument(value: unknown): FactoryConfigIssue[] {
	const issues: FactoryConfigIssue[] = [];
	if (!isPlainObject(value)) {
		issues.push({ path: "", message: "factory instance manifest must be an object" });
		return issues;
	}

	const doc = value as Record<string, unknown>;
	const schemaResult = factoryInstanceManifestDocumentSchema.safeParse(doc);
	if (!schemaResult.success) {
		appendSchemaIssues(issues, schemaResult.error);
	}
	requireString(doc, "instance_id", issues);

	const kindId = requireString(doc, "kind_id", issues);
	if (kindId && !FACTORY_ID_PATTERN.test(kindId)) {
		issues.push({ path: "kind_id", message: "must match /^[a-z0-9-]+$/" });
	}

	const targetRepoObj = requireObject(doc, "target_repo", issues);
	if (targetRepoObj) {
		requireString(targetRepoObj, "provider", issues, "target_repo.provider");
		requireString(targetRepoObj, "repo_id", issues, "target_repo.repo_id");
		const fullName = requireString(targetRepoObj, "full_name", issues, "target_repo.full_name");
		if (fullName && !OWNER_REPO_PATTERN.test(fullName)) {
			issues.push({ path: "target_repo.full_name", message: "must be owner/repo" });
		}
	}

	validateOwnerRepoField(doc, "control_plane_repo", issues);

	const destinations = requireObject(doc, "destinations", issues);
	if (destinations) {
		const entries = Object.entries(destinations);
		if (entries.length === 0) {
			issues.push({ path: "destinations", message: "must define at least one destination route" });
		}
		for (const [routeName, routeValue] of entries) {
			const routePath = `destinations.${routeName}`;
			if (routeName.trim() === "") {
				issues.push({ path: "destinations", message: "destination route keys must be non-empty strings" });
				continue;
			}
			if (!isPlainObject(routeValue)) {
				issues.push({ path: routePath, message: "must be an object" });
				continue;
			}
			const routeRepo = requireString(routeValue, "repo", issues, `${routePath}.repo`);
			if (routeRepo && !OWNER_REPO_PATTERN.test(routeRepo)) {
				issues.push({ path: `${routePath}.repo`, message: "must be owner/repo" });
			}
			optionalStringArray(routeValue, "labels", issues, `${routePath}.labels`);
		}
	}

	if (doc["intake"] !== undefined && !isPlainObject(doc["intake"])) {
		issues.push({ path: "intake", message: "must be an object" });
	}

	return finalizeIssues(issues);
}

export function parseFactoryInstanceManifestDocument(value: unknown): FactoryInstanceManifestDocument {
	const issues = validateFactoryInstanceManifestDocument(value);
	if (issues.length > 0) {
		throw new Error(formatFactoryConfigIssue(issues[0]));
	}
	return value as FactoryInstanceManifestDocument;
}

export function validateFactoryServiceRegistryDocument(value: unknown): FactoryConfigIssue[] {
	const issues: FactoryConfigIssue[] = [];
	if (!isPlainObject(value)) {
		issues.push({ path: "", message: "factory service registry must be an object" });
		return issues;
	}

	const doc = value as Record<string, unknown>;
	const schemaResult = factoryServiceRegistryDocumentSchema.safeParse(doc);
	if (!schemaResult.success) {
		appendSchemaIssues(issues, schemaResult.error);
	}
	const instances = doc["instances"];
	if (!Array.isArray(instances)) {
		issues.push({ path: "instances", message: "must be an array" });
		return issues;
	}

	for (let index = 0; index < instances.length; index += 1) {
		const record = instances[index];
		const recordPath = `instances[${index}]`;
		if (!isPlainObject(record)) {
			issues.push({ path: recordPath, message: "must be an object" });
			continue;
		}

		requireString(record, "instance_id", issues, `${recordPath}.instance_id`);
		const kindId = requireString(record, "kind_id", issues, `${recordPath}.kind_id`);
		if (kindId && !FACTORY_ID_PATTERN.test(kindId)) {
			issues.push({ path: `${recordPath}.kind_id`, message: "must match /^[a-z0-9-]+$/" });
		}

		const targetRepo = requireString(record, "target_repo", issues, `${recordPath}.target_repo`);
		if (targetRepo && !OWNER_REPO_PATTERN.test(targetRepo)) {
			issues.push({ path: `${recordPath}.target_repo`, message: "must be owner/repo" });
		}

		const controlPlaneRepo = requireString(record, "control_plane_repo", issues, `${recordPath}.control_plane_repo`);
		if (controlPlaneRepo && !OWNER_REPO_PATTERN.test(controlPlaneRepo)) {
			issues.push({ path: `${recordPath}.control_plane_repo`, message: "must be owner/repo" });
		}

		requireString(record, "status", issues, `${recordPath}.status`);
		requireString(record, "assigned_host_id", issues, `${recordPath}.assigned_host_id`);
		validateServiceProfileFields(record, issues, recordPath);

		const allowedKeys = new Set([
			"instance_id",
			"kind_id",
			"target_repo",
			"control_plane_repo",
			"status",
			"assigned_host_id",
			...SERVICE_PROFILE_KEYS,
		]);
		for (const key of Object.keys(record)) {
			if (!allowedKeys.has(key)) {
				issues.push({ path: `${recordPath}.${key}`, message: `unknown key "${key}"` });
			}
		}
	}

	return finalizeIssues(issues);
}

export function parseFactoryServiceRegistryDocument(value: unknown): FactoryServiceRegistryDocument {
	const issues = validateFactoryServiceRegistryDocument(value);
	if (issues.length > 0) {
		throw new Error(formatFactoryConfigIssue(issues[0]));
	}
	return value as FactoryServiceRegistryDocument;
}

export function validateFactoryInstallationManifestDocument(value: unknown): FactoryConfigIssue[] {
	const issues: FactoryConfigIssue[] = [];
	if (!isPlainObject(value)) {
		issues.push({ path: "", message: "factory installation manifest must be an object" });
		return issues;
	}

	const doc = value as Record<string, unknown>;
	const schemaResult = factoryInstallationManifestDocumentSchema.safeParse(doc);
	if (!schemaResult.success) {
		appendSchemaIssues(issues, schemaResult.error);
	}
	requireString(doc, "installation_id", issues);
	requireString(doc, "instance_id", issues);
	requireString(doc, "host_id", issues);
	const workspaceMode = requireString(doc, "workspace_mode", issues);
	if (workspaceMode && !FACTORY_INSTALLATION_WORKSPACE_MODES.includes(workspaceMode as FactoryInstallationWorkspaceMode)) {
		issues.push({
			path: "workspace_mode",
			message: `must be one of: ${FACTORY_INSTALLATION_WORKSPACE_MODES.join(", ")}`,
		});
	}

	if ("log_dir" in doc) {
		optionalString(doc, "log_dir", issues, "log_dir");
	}

	if ("work_dir" in doc) {
		const workDir = doc["work_dir"];
		if (workDir !== null && (typeof workDir !== "string" || workDir.trim() === "")) {
			issues.push({ path: "work_dir", message: "must be a non-empty string or null" });
		}
	}

	if (workspaceMode === "checkout" || workspaceMode === "worktree") {
		const workDir = doc["work_dir"];
		if (typeof workDir !== "string" || workDir.trim() === "") {
			issues.push({
				path: "work_dir",
				message: "required when workspace_mode is checkout or worktree",
			});
		}
	}

	return finalizeIssues(issues);
}

export function parseFactoryInstallationManifestDocument(value: unknown): FactoryInstallationManifestDocument {
	const issues = validateFactoryInstallationManifestDocument(value);
	if (issues.length > 0) {
		throw new Error(formatFactoryConfigIssue(issues[0]));
	}
	return value as FactoryInstallationManifestDocument;
}

export function getFactoryIsolationConfig(factoryConfig: unknown): FactoryIsolationConfig | undefined {
	if (!isPlainObject(factoryConfig)) return undefined;
	const doc = factoryConfig as Record<string, unknown>;
	const rawIsolation = doc["isolation"];
	if (rawIsolation === undefined) return undefined;

	const issues: FactoryConfigIssue[] = [];
	validateIsolationDocument(rawIsolation, issues, "isolation");
	if (issues.length > 0) {
		throw new Error(`[factory-config] ${formatFactoryConfigIssue(issues[0])}`);
	}

	const isolation = rawIsolation as Record<string, unknown>;
	const normalized: FactoryIsolationConfig = {};

	const auth = isPlainObject(isolation["auth"]) ? (isolation["auth"] as Record<string, unknown>) : undefined;
	const github = auth && isPlainObject(auth["github"]) ? (auth["github"] as Record<string, unknown>) : undefined;
	if (github) {
		normalized.auth = {
			github: {
				repo: trim(github["repo"]),
				factoryId: trimOrUndefined(github["factoryId"]),
				tokenEnvVar: trimOrUndefined(github["tokenEnvVar"]),
			},
		};
	}
	const authStoragePath = trimOrUndefined(isolation["authStoragePath"]);
	if (authStoragePath) {
		normalized.authStoragePath = authStoragePath;
	}

	const model = isPlainObject(isolation["model"]) ? (isolation["model"] as Record<string, unknown>) : undefined;
	if (model) {
		normalized.model = {
			envVar: trimOrUndefined(model["envVar"]),
			value: trimOrUndefined(model["value"]),
		};
	}

	const provider = isPlainObject(isolation["provider"]) ? (isolation["provider"] as Record<string, unknown>) : undefined;
	if (provider) {
		normalized.provider = {
			envVar: trimOrUndefined(provider["envVar"]),
			value: trimOrUndefined(provider["value"]),
		};
	}

	const paths = isPlainObject(isolation["paths"]) ? (isolation["paths"] as Record<string, unknown>) : undefined;
	if (paths) {
		normalized.paths = {
			runs: trimOrUndefined(paths["runs"]),
			logs: trimOrUndefined(paths["logs"]),
			tmp: trimOrUndefined(paths["tmp"]),
			cache: trimOrUndefined(paths["cache"]),
		};
	}

	return normalized;
}

export function assertFactoryIsolationContext({
	isolationConfig,
	factoryId = "",
	targetRepo = "",
	env = process.env,
}: AssertFactoryIsolationContextArgs): void {
	const github = isolationConfig?.auth?.github;
	if (!github) return;

	const resolvedFactoryId = trim(factoryId);
	const resolvedTargetRepo = trim(targetRepo);

	if (!resolvedTargetRepo) {
		throw new Error(
			"[factory-context] isolation.auth.github.repo is configured but resolved factory target_repo is empty. "
			+ "Set --repo <owner/repo>, HATCH_TARGET_REPO, or target_repo in factory.config.json.",
		);
	}

	if (github.repo !== resolvedTargetRepo) {
		throw new Error(
			`[factory-context] expected isolation.auth.github.repo=${github.repo} but resolved factory target=${resolvedTargetRepo}. `
			+ "Update factory.config.json isolation.auth.github.repo or resolve the correct factory context.",
		);
	}

	if (github.factoryId && github.factoryId !== resolvedFactoryId) {
		throw new Error(
			`[factory-context] expected isolation.auth.github.factoryId=${github.factoryId} but resolved factory_id=${resolvedFactoryId || "(empty)"}. `
			+ "Use the matching --factory-id/--factory-root or update isolation.auth.github.factoryId.",
		);
	}

	if (github.tokenEnvVar) {
		const token = trim(env[github.tokenEnvVar]);
		if (!token) {
			throw new Error(
				`[factory-context] missing required env var for isolation.auth.github.tokenEnvVar=${github.tokenEnvVar}. `
				+ `Export ${github.tokenEnvVar} for factory ${resolvedFactoryId || "(unknown)"} before running hatch-ops.`,
			);
		}
	}
}

export function resolveFactoryRuntimePaths(
	isolationConfig: FactoryIsolationConfig | undefined,
	defaults: FactoryRuntimePathDefaults,
): FactoryRuntimePaths {
	const defaultRuns = trim(defaults.runs);
	if (!defaultRuns) {
		throw new Error("[factory-config] defaults.runs must be a non-empty path");
	}

	const baseDir = trim(defaults.baseDir) || process.cwd();
	const defaultRunsResolved = normalizeRuntimePath(defaultRuns, baseDir);
	const defaultLogsResolved = normalizeRuntimePath(defaults.logs || path.join(defaultRunsResolved, "logs"), baseDir);
	const defaultTmpResolved = normalizeRuntimePath(defaults.tmp || path.join(defaultRunsResolved, "tmp"), baseDir);
	const defaultCacheResolved = normalizeRuntimePath(defaults.cache || path.join(defaultRunsResolved, "cache"), baseDir);

	const isolationPaths = isolationConfig?.paths;
	const runs = normalizeRuntimePath(isolationPaths?.runs || defaultRunsResolved, baseDir);
	const logs = normalizeRuntimePath(isolationPaths?.logs || defaultLogsResolved, baseDir);
	const tmp = normalizeRuntimePath(isolationPaths?.tmp || defaultTmpResolved, baseDir);
	const cache = normalizeRuntimePath(isolationPaths?.cache || defaultCacheResolved, baseDir);

	return { runs, logs, tmp, cache };
}

export function formatFactoryConfigIssue(issue: FactoryConfigIssue): string {
	return `${issue.path || "(root)"}: ${issue.message}`;
}
function validateCapabilitiesDocument(value: unknown, issues: FactoryConfigIssue[], pathPrefix: string): void {
	if (!isPlainObject(value)) {
		issues.push({ path: pathPrefix, message: "must be an object" });
		return;
	}

	const capabilities = value as Record<string, unknown>;
	if (capabilities["goal_decomposition"] !== undefined) {
		validateGoalDecompositionDocument(
			capabilities["goal_decomposition"],
			issues,
			`${pathPrefix}.goal_decomposition`,
		);
	}
	if (capabilities["demo"] !== undefined) {
		validateDemoDocument(capabilities["demo"], issues, `${pathPrefix}.demo`);
	}
}

function validateDemoDocument(value: unknown, issues: FactoryConfigIssue[], pathPrefix: string): void {
	if (!isPlainObject(value)) { issues.push({ path: pathPrefix, message: "must be an object" }); return; }
	const demo = value as Record<string, unknown>;
	if (!("policy" in demo)) return;
	const policy = optionalString(demo, "policy", issues, `${pathPrefix}.policy`);
	if (!policy || FACTORY_CONFIG_DEMO_POLICIES.includes(policy as FactoryConfigDemoPolicy)) return;
	issues.push({ path: `${pathPrefix}.policy`, message: `must be one of: ${FACTORY_CONFIG_DEMO_POLICIES.join(", ")}` });
}

function validateGoalDecompositionDocument(value: unknown, issues: FactoryConfigIssue[], pathPrefix: string): void {
	if (!isPlainObject(value)) {
		issues.push({ path: pathPrefix, message: "must be an object" });
		return;
	}

	const goalDecomposition = value as Record<string, unknown>;
	const timeouts = optionalObject(goalDecomposition, "timeouts", issues, `${pathPrefix}.timeouts`);
	if (!timeouts) {
		return;
	}

	const allowedStageKeys = new Set<string>(GOAL_DECOMPOSITION_TIMEOUT_STAGES);
	for (const key of Object.keys(timeouts)) {
		if (allowedStageKeys.has(key)) {
			continue;
		}
		issues.push({
			path: `${pathPrefix}.timeouts.${key}`,
			message: `unsupported timeout stage; expected one of ${GOAL_DECOMPOSITION_TIMEOUT_STAGES.join(", ")}`,
		});
	}

	for (const stage of GOAL_DECOMPOSITION_TIMEOUT_STAGES) {
		if (!(stage in timeouts)) {
			continue;
		}
		const value = optionalString(timeouts, stage, issues, `${pathPrefix}.timeouts.${stage}`);
		if (value && !/^\d+(ms|s|m|h|d)$/.test(value)) {
			issues.push({
				path: `${pathPrefix}.timeouts.${stage}`,
				message: "must match /^\\d+(ms|s|m|h|d)$/",
			});
		}
	}
}
function validatePolicyPackDocument(value: unknown, issues: FactoryConfigIssue[], pathPrefix: string): void {
	if (!isPlainObject(value)) {
		issues.push({ path: pathPrefix, message: "must be an object" });
		return;
	}

	const policyPack = value as Record<string, unknown>;
	requireString(policyPack, "version", issues, `${pathPrefix}.version`);
	if (policyPack["overrides"] !== undefined && !isPlainObject(policyPack["overrides"])) {
		issues.push({ path: `${pathPrefix}.overrides`, message: "must be an object" });
	}
}

function validateIsolationDocument(value: unknown, issues: FactoryConfigIssue[], pathPrefix: string): void {
	if (!isPlainObject(value)) {
		issues.push({ path: pathPrefix, message: "must be an object" });
		return;
	}

	const isolation = value as Record<string, unknown>;
	const auth = optionalObject(isolation, "auth", issues, `${pathPrefix}.auth`);
	if (auth) {
		const github = optionalObject(auth, "github", issues, `${pathPrefix}.auth.github`);
		if (github) {
			optionalString(github, "tokenEnvVar", issues, `${pathPrefix}.auth.github.tokenEnvVar`);
			const repo = requireString(github, "repo", issues, `${pathPrefix}.auth.github.repo`);
			if (repo && !OWNER_REPO_PATTERN.test(repo)) {
				issues.push({ path: `${pathPrefix}.auth.github.repo`, message: "must be owner/repo" });
			}
			const configFactoryId = optionalString(github, "factoryId", issues, `${pathPrefix}.auth.github.factoryId`);
			if (configFactoryId && !FACTORY_ID_PATTERN.test(configFactoryId)) {
				issues.push({ path: `${pathPrefix}.auth.github.factoryId`, message: "must match /^[a-z0-9-]+$/" });
			}
		}
	}
	optionalString(isolation, "authStoragePath", issues, `${pathPrefix}.authStoragePath`);

	const model = optionalObject(isolation, "model", issues, `${pathPrefix}.model`);
	if (model) {
		validateIsolationValueSource(model, `${pathPrefix}.model`, issues);
	}

	const provider = optionalObject(isolation, "provider", issues, `${pathPrefix}.provider`);
	if (provider) {
		validateIsolationValueSource(provider, `${pathPrefix}.provider`, issues);
	}

	const paths = optionalObject(isolation, "paths", issues, `${pathPrefix}.paths`);
	if (paths) {
		optionalString(paths, "runs", issues, `${pathPrefix}.paths.runs`);
		optionalString(paths, "logs", issues, `${pathPrefix}.paths.logs`);
		optionalString(paths, "tmp", issues, `${pathPrefix}.paths.tmp`);
		optionalString(paths, "cache", issues, `${pathPrefix}.paths.cache`);
	}
}
function validateIsolationValueSource(
	valueSource: Record<string, unknown>,
	pathPrefix: string,
	issues: FactoryConfigIssue[],
): void {
	const envVar = optionalString(valueSource, "envVar", issues, `${pathPrefix}.envVar`);
	const literalValue = optionalString(valueSource, "value", issues, `${pathPrefix}.value`);
	if (!envVar && !literalValue) {
		issues.push({
			path: pathPrefix,
			message: "must define at least one of envVar or value",
		});
	}
}
function validateOwnerRepoField(
	doc: Record<string, unknown>,
	key: "target_repo" | "control_plane_repo" | "upstream_repo",
	issues: FactoryConfigIssue[],
): void {
	const value = requireString(doc, key, issues);
	if (value && !OWNER_REPO_PATTERN.test(value)) {
		issues.push({ path: key, message: "must be owner/repo" });
	}
}
function requireString(
	doc: Record<string, unknown>,
	key: string,
	issues: FactoryConfigIssue[],
	pathOverride?: string,
): string | undefined {
	const value = doc[key];
	if (typeof value !== "string" || value.trim() === "") {
		issues.push({ path: pathOverride ?? key, message: "must be a non-empty string" });
		return undefined;
	}
	return value;
}
function optionalString(
	doc: Record<string, unknown>,
	key: string,
	issues: FactoryConfigIssue[],
	pathOverride?: string,
): string | undefined {
	if (!(key in doc)) return undefined;
	const value = doc[key];
	if (typeof value !== "string" || value.trim() === "") {
		issues.push({ path: pathOverride ?? key, message: "must be a non-empty string" });
		return undefined;
	}
	return value;
}
function requireObject(
	doc: Record<string, unknown>,
	key: string,
	issues: FactoryConfigIssue[],
): Record<string, unknown> | undefined {
	const value = doc[key];
	if (!isPlainObject(value)) {
		issues.push({ path: key, message: "must be an object" });
		return undefined;
	}
	return value;
}
function optionalObject(
	doc: Record<string, unknown>,
	key: string,
	issues: FactoryConfigIssue[],
	pathOverride?: string,
): Record<string, unknown> | undefined {
	if (!(key in doc)) return undefined;
	const value = doc[key];
	if (!isPlainObject(value)) {
		issues.push({ path: pathOverride ?? key, message: "must be an object" });
		return undefined;
	}
	return value;
}
function optionalBoolean(
	doc: Record<string, unknown>,
	key: string,
	issues: FactoryConfigIssue[],
	pathOverride?: string,
): boolean | undefined {
	if (!(key in doc)) return undefined;
	const value = doc[key];
	if (typeof value !== "boolean") {
		issues.push({ path: pathOverride ?? key, message: "must be a boolean" });
		return undefined;
	}
	return value;
}
function optionalNumber(
	doc: Record<string, unknown>,
	key: string,
	issues: FactoryConfigIssue[],
	pathOverride?: string,
): number | undefined {
	if (!(key in doc)) return undefined;
	const value = doc[key];
	if (typeof value !== "number" || !Number.isFinite(value)) {
		issues.push({ path: pathOverride ?? key, message: "must be a finite number" });
		return undefined;
	}
	return value;
}
function optionalPositiveInteger(
	doc: Record<string, unknown>,
	key: string,
	issues: FactoryConfigIssue[],
	pathOverride?: string,
): number | undefined {
	const value = optionalNumber(doc, key, issues, pathOverride);
	if (value === undefined) return undefined;
	if (!Number.isInteger(value) || value <= 0) {
		issues.push({ path: pathOverride ?? key, message: "must be a positive integer" });
		return undefined;
	}
	return value;
}
function optionalStringArray(
	doc: Record<string, unknown>,
	key: string,
	issues: FactoryConfigIssue[],
	pathOverride?: string,
): string[] | undefined {
	if (!(key in doc)) return undefined;
	const value = doc[key];
	if (!Array.isArray(value)) {
		issues.push({ path: pathOverride ?? key, message: "must be an array of non-empty strings" });
		return undefined;
	}
	const normalized: string[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const entry = value[index];
		if (typeof entry !== "string" || entry.trim() === "") {
			issues.push({ path: `${pathOverride ?? key}[${index}]`, message: "must be a non-empty string" });
			continue;
		}
		normalized.push(entry);
	}
	return normalized;
}
function trim(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}
function trimOrUndefined(value: unknown): string | undefined {
	const normalized = trim(value);
	return normalized || undefined;
}
function normalizeRuntimePath(raw: string, baseDir: string): string {
	const trimmed = trim(raw);
	if (!trimmed) {
		throw new Error("[factory-config] runtime path must be a non-empty string");
	}
	return path.isAbsolute(trimmed) ? trimmed : path.resolve(baseDir, trimmed);
}
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
