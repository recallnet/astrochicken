import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { isValidFactoryInstanceId } from "../factory/identity.js";
import { SERVICE_PROFILE_KEYS, normalizeServiceProfile, validateServiceProfileFields } from "../factory/service-profile.js";

export const FACTORY_REGISTRY_SCHEMA_VERSION = "hatch.factory.registry.v1" as const;

export interface FactoryRegistryDocument {
	schema: typeof FACTORY_REGISTRY_SCHEMA_VERSION;
	factories?: FactoryRegistryFactoryDocument[];
	instances?: FactoryRegistryInstanceDocument[];
}

export interface FactoryRegistryFactoryDocument {
	id: string;
	instance_id?: string;
	repo: string;
	graphs: FactoryRegistryGraphDocument[];
	priority?: number;
	concurrency?: FactoryRegistryConcurrencyDocument;
	daemonStatus?: FactoryRegistryDaemonStatusDocument;
}

export interface FactoryRegistryInstanceDocument {
	instance_id: string;
	kind_id: string;
	target_repo: string;
	status: string;
	assigned_host_id: string;
	installation_manifest_path?: string;
	graphs?: FactoryRegistryGraphDocument[];
	daemonStatus?: FactoryRegistryDaemonStatusDocument;
	service_tier?: string;
	scheduler_weight?: number;
	reserved_capacity?: number;
	upgrade_channel?: string;
	allowed_runtime_version?: string;
	support_owner?: string;
	feature_flags?: Record<string, string>;
}

export interface FactoryRegistryGraphDocument {
	id: string;
	path: string;
}

export interface FactoryRegistryConcurrencyDocument {
	max_concurrent_runs?: number;
	max_concurrent_waves?: number;
}

export interface FactoryRegistryDaemonStatusDocument {
	status: "running" | "stopped";
	pid?: number;
	last_tick_at?: string;
	run_id?: string;
}

export interface FactoryRegistry {
	schema: typeof FACTORY_REGISTRY_SCHEMA_VERSION;
	factories: FactoryRegistryFactory[];
}

export interface FactoryRegistryFactory {
	id: string;
	instance_id?: string;
	repo: string;
	graphs: FactoryRegistryGraph[];
	priority: number;
	concurrency: FactoryRegistryConcurrency;
	daemonStatus?: FactoryRegistryDaemonStatus;
	service_tier: string;
	scheduler_weight: number;
	reserved_capacity: number;
	upgrade_channel: string;
	allowed_runtime_version: string;
	support_owner: string;
	feature_flags: Record<string, string>;
}

export interface FactoryRegistryGraph {
	id: string;
	path: string;
}

export interface FactoryRegistryConcurrency {
	max_concurrent_runs: number;
	max_concurrent_waves: number;
}

export interface FactoryRegistryDaemonStatus {
	status: "running" | "stopped";
	pid?: number;
	last_tick_at?: string;
	run_id?: string;
}

export interface FactoryRegistryIssue {
	path: string;
	message: string;
}

export class FactoryRegistrySchemaError extends Error {
	constructor(public issues: FactoryRegistryIssue[]) {
		super(formatFactoryRegistryIssues(issues));
	}
}

export class FactoryRegistryLoadError extends Error {
	constructor(public issues: FactoryRegistryIssue[]) {
		super(formatFactoryRegistryIssues(issues));
	}
}

export interface FactoryRegistryLoadOptions {
	rootDir?: string;
	registryPath?: string;
}

const DEFAULT_FACTORY_REGISTRY_PATH = "factory-registry.json";

const ROOT_KEYS = new Set(["schema", "factories", "instances"]);
const FACTORY_KEYS = new Set(["id", "instance_id", "repo", "graphs", "priority", "concurrency", "daemonStatus"]);
// Canonical service profile keys for managed instances.
const INSTANCE_KEYS = new Set([
	"instance_id",
	"kind_id",
	"target_repo",
	"status",
	"assigned_host_id",
	"installation_manifest_path",
	"graphs",
	"daemonStatus",
	...SERVICE_PROFILE_KEYS,
]);
const GRAPH_KEYS = new Set(["id", "path"]);
const CONCURRENCY_KEYS = new Set(["max_concurrent_runs", "max_concurrent_waves"]);
const DAEMON_STATUS_KEYS = new Set(["status", "pid", "last_tick_at", "run_id"]);

export function loadFactoryRegistry(options: FactoryRegistryLoadOptions = {}): FactoryRegistry {
	const rootDir = options.rootDir ?? process.cwd();
	const registryPath = options.registryPath ?? DEFAULT_FACTORY_REGISTRY_PATH;
	const filePath = resolve(rootDir, registryPath);

	if (!existsSync(filePath)) {
		throw new FactoryRegistryLoadError([{ path: filePath, message: "registry file not found" }]);
	}

	let raw: string;
	try {
		raw = readFileSync(filePath, "utf8");
	} catch (err) {
		throw new FactoryRegistryLoadError([
			{
				path: filePath,
				message: `failed to read registry file: ${err instanceof Error ? err.message : String(err)}`,
			},
		]);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new FactoryRegistryLoadError([
			{
				path: filePath,
				message: `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
			},
		]);
	}

	let doc: FactoryRegistryDocument;
	try {
		doc = parseFactoryRegistryDocument(parsed);
	} catch (err) {
		if (err instanceof FactoryRegistrySchemaError) {
			const issues = err.issues.map((issue) => ({
				path: issue.path ? `${filePath}:${issue.path}` : filePath,
				message: issue.message,
			}));
			throw new FactoryRegistryLoadError(issues);
		}
		throw new FactoryRegistryLoadError([
			{
				path: filePath,
				message: err instanceof Error ? err.message : "factory registry schema validation failed",
			},
		]);
	}

	return normalizeFactoryRegistry(doc);
}

export function validateFactoryRegistryDocument(value: unknown): FactoryRegistryIssue[] {
	const issues: FactoryRegistryIssue[] = [];
	if (!isPlainObject(value)) {
		issues.push({ path: "", message: "factory registry must be an object" });
		return issues;
	}

	const doc = value as Record<string, unknown>;
	for (const key of Object.keys(doc)) {
		if (!ROOT_KEYS.has(key)) {
			issues.push({ path: key, message: `unknown key "${key}"` });
		}
	}

	const schema = doc["schema"];
	if (schema !== FACTORY_REGISTRY_SCHEMA_VERSION) {
		issues.push({
			path: "schema",
			message: `schema must be "${FACTORY_REGISTRY_SCHEMA_VERSION}"`,
		});
	}

	const factories = Array.isArray(doc["factories"]) ? doc["factories"] : null;
	const instances = Array.isArray(doc["instances"]) ? doc["instances"] : null;
	if (!factories && !instances) {
		issues.push({ path: "instances", message: "must define instances[] or factories[]" });
		return issues;
	}

	const factoryIds = new Set<string>();

	(factories ?? []).forEach((factoryValue, index) => {
		const pathPrefix = `factories[${index}]`;
		if (!isPlainObject(factoryValue)) {
			issues.push({ path: pathPrefix, message: "factory must be an object" });
			return;
		}

		const factory = factoryValue as Record<string, unknown>;
		for (const key of Object.keys(factory)) {
			if (!FACTORY_KEYS.has(key)) {
				issues.push({ path: `${pathPrefix}.${key}`, message: `unknown key "${key}"` });
			}
		}

		const id = requireString(factory, "id", issues, `${pathPrefix}.id`);
		if (id) {
			if (factoryIds.has(id)) {
				issues.push({ path: `${pathPrefix}.id`, message: `duplicate factory id "${id}"` });
			} else {
				factoryIds.add(id);
			}
		}

		const instanceId = optionalString(factory, "instance_id", issues, `${pathPrefix}.instance_id`);
		if (instanceId && !isValidFactoryInstanceId(instanceId, { allowGrandfatheredMothership: true })) {
			issues.push({
				path: `${pathPrefix}.instance_id`,
				message: 'must be a valid fac_* id or "mothership"',
			});
		}

		const repo = requireString(factory, "repo", issues, `${pathPrefix}.repo`);
		if (repo && !looksLikeRepoOrPath(repo)) {
			issues.push({ path: `${pathPrefix}.repo`, message: "must be an owner/repo or local path" });
		}

		const graphsValue = factory["graphs"];
		if (!Array.isArray(graphsValue)) {
			issues.push({ path: `${pathPrefix}.graphs`, message: "must be a non-empty array" });
			return;
		}
		if (graphsValue.length === 0) {
			issues.push({ path: `${pathPrefix}.graphs`, message: "must be a non-empty array" });
		}

		const graphIds = new Set<string>();
		graphsValue.forEach((graphValue, graphIndex) => {
			const graphPath = `${pathPrefix}.graphs[${graphIndex}]`;
			if (!isPlainObject(graphValue)) {
				issues.push({ path: graphPath, message: "graph must be an object" });
				return;
			}

			const graph = graphValue as Record<string, unknown>;
			for (const key of Object.keys(graph)) {
				if (!GRAPH_KEYS.has(key)) {
					issues.push({ path: `${graphPath}.${key}`, message: `unknown key "${key}"` });
				}
			}

			const id = requireString(graph, "id", issues, `${graphPath}.id`);
			if (id) {
				if (graphIds.has(id)) {
					issues.push({ path: `${graphPath}.id`, message: `duplicate graph id "${id}"` });
				} else {
					graphIds.add(id);
				}
			}

			const pathValue = requireString(graph, "path", issues, `${graphPath}.path`);
			if (pathValue && !isRelativePath(pathValue)) {
				issues.push({
					path: `${graphPath}.path`,
					message: "path must be relative to repo root",
				});
			}
		});

		optionalNumber(factory, "priority", issues, `${pathPrefix}.priority`);
		validateConcurrency(factory["concurrency"], issues, `${pathPrefix}.concurrency`);
		validateDaemonStatus(factory["daemonStatus"], issues, `${pathPrefix}.daemonStatus`);
	});

	const instanceIds = new Set<string>();
	(instances ?? []).forEach((instanceValue, index) => {
		const pathPrefix = `instances[${index}]`;
		if (!isPlainObject(instanceValue)) {
			issues.push({ path: pathPrefix, message: "instance must be an object" });
			return;
		}
		const instance = instanceValue as Record<string, unknown>;
		for (const key of Object.keys(instance)) {
			if (!INSTANCE_KEYS.has(key)) {
				issues.push({ path: `${pathPrefix}.${key}`, message: `unknown key "${key}"` });
			}
		}
		const instanceId = requireString(instance, "instance_id", issues, `${pathPrefix}.instance_id`);
		if (instanceId) {
			if (instanceIds.has(instanceId)) {
				issues.push({ path: `${pathPrefix}.instance_id`, message: `duplicate instance id "${instanceId}"` });
			} else {
				instanceIds.add(instanceId);
			}
		}
		requireString(instance, "kind_id", issues, `${pathPrefix}.kind_id`);
		const targetRepo = requireString(instance, "target_repo", issues, `${pathPrefix}.target_repo`);
		if (targetRepo && !looksLikeRepoOrPath(targetRepo)) {
			issues.push({ path: `${pathPrefix}.target_repo`, message: "must be an owner/repo or local path" });
		}
		requireString(instance, "status", issues, `${pathPrefix}.status`);
		requireString(instance, "assigned_host_id", issues, `${pathPrefix}.assigned_host_id`);
		optionalString(instance, "installation_manifest_path", issues, `${pathPrefix}.installation_manifest_path`);
		validateServiceProfileFields(instance, issues, pathPrefix);
		const graphsValue = instance["graphs"];
		if (graphsValue !== undefined) {
			if (!Array.isArray(graphsValue)) {
				issues.push({ path: `${pathPrefix}.graphs`, message: "must be an array" });
			} else {
				graphsValue.forEach((graphValue, graphIndex) => {
					const graphPath = `${pathPrefix}.graphs[${graphIndex}]`;
					if (!isPlainObject(graphValue)) {
						issues.push({ path: graphPath, message: "graph must be an object" });
						return;
					}
					const graph = graphValue as Record<string, unknown>;
					requireString(graph, "id", issues, `${graphPath}.id`);
					const pathValue = requireString(graph, "path", issues, `${graphPath}.path`);
					if (pathValue && !isRelativePath(pathValue)) {
						issues.push({ path: `${graphPath}.path`, message: "path must be relative to repo root" });
					}
				});
			}
		}
		validateDaemonStatus(instance["daemonStatus"], issues, `${pathPrefix}.daemonStatus`);
	});

	return issues;
}

export function parseFactoryRegistryDocument(value: unknown): FactoryRegistryDocument {
	const issues = validateFactoryRegistryDocument(value);
	if (issues.length > 0) {
		throw new FactoryRegistrySchemaError(issues);
	}
	return value as FactoryRegistryDocument;
}

export function formatFactoryRegistryIssues(issues: FactoryRegistryIssue[]): string {
	return issues.map((issue) => `- ${issue.path || "(root)"}: ${issue.message}`).join("\n");
}

function normalizeFactoryRegistry(doc: FactoryRegistryDocument): FactoryRegistry {
	const rows = Array.isArray(doc.instances) && doc.instances.length > 0
		? doc.instances.map((instance) => {
			const serviceProfile = normalizeServiceProfile({
				service_tier: instance.service_tier,
				scheduler_weight: instance.scheduler_weight,
				reserved_capacity: instance.reserved_capacity,
				upgrade_channel: instance.upgrade_channel,
				allowed_runtime_version: instance.allowed_runtime_version,
				support_owner: instance.support_owner,
				feature_flags: instance.feature_flags,
			});
			return {
				id: instance.instance_id,
				instance_id: instance.instance_id,
				repo: instance.target_repo,
				graphs: (instance.graphs ?? []).map((graph) => ({
					id: graph.id,
					path: graph.path,
				})),
				priority: 0,
				concurrency: {
					max_concurrent_runs: 1,
					max_concurrent_waves: 1,
				},
				daemonStatus: instance.daemonStatus
					? {
						status: instance.daemonStatus.status,
						pid: instance.daemonStatus.pid,
						last_tick_at: instance.daemonStatus.last_tick_at,
						run_id: instance.daemonStatus.run_id,
					}
					: undefined,
				...serviceProfile,
			};
		})
		: (doc.factories ?? []).map((factory) => ({
			id: factory.id,
			instance_id: factory.instance_id,
			repo: factory.repo,
			graphs: factory.graphs.map((graph) => ({
				id: graph.id,
				path: graph.path,
			})),
			priority: factory.priority ?? 0,
			concurrency: {
				max_concurrent_runs: factory.concurrency?.max_concurrent_runs ?? 1,
				max_concurrent_waves: factory.concurrency?.max_concurrent_waves ?? 1,
			},
			daemonStatus: factory.daemonStatus
				? {
					status: factory.daemonStatus.status,
					pid: factory.daemonStatus.pid,
					last_tick_at: factory.daemonStatus.last_tick_at,
					run_id: factory.daemonStatus.run_id,
				}
				: undefined,
			...normalizeServiceProfile(),
		}));
	return {
		schema: doc.schema,
		factories: rows,
	};
}

function requireString(
	doc: Record<string, unknown>,
	key: string,
	issues: FactoryRegistryIssue[],
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
	issues: FactoryRegistryIssue[],
	pathOverride?: string,
): string | undefined {
	const value = doc[key];
	if (value === undefined) return undefined;
	if (typeof value !== "string" || value.trim() === "") {
		issues.push({ path: pathOverride ?? key, message: "must be a non-empty string" });
		return undefined;
	}
	return value;
}

function optionalNumber(
	doc: Record<string, unknown>,
	key: string,
	issues: FactoryRegistryIssue[],
	pathOverride?: string,
): void {
	const value = doc[key];
	if (value === undefined) return;
	if (typeof value !== "number" || Number.isNaN(value)) {
		issues.push({ path: pathOverride ?? key, message: "must be a number" });
	}
}

function validateConcurrency(value: unknown, issues: FactoryRegistryIssue[], pathPrefix: string): void {
	if (value === undefined) return;
	if (!isPlainObject(value)) {
		issues.push({ path: pathPrefix, message: "must be an object" });
		return;
	}

	const concurrency = value as Record<string, unknown>;
	for (const key of Object.keys(concurrency)) {
		if (!CONCURRENCY_KEYS.has(key)) {
			issues.push({ path: `${pathPrefix}.${key}`, message: `unknown key "${key}"` });
		}
	}

	optionalPositiveInt(concurrency, "max_concurrent_runs", issues, `${pathPrefix}.max_concurrent_runs`);
	optionalPositiveInt(concurrency, "max_concurrent_waves", issues, `${pathPrefix}.max_concurrent_waves`);
}

function validateDaemonStatus(value: unknown, issues: FactoryRegistryIssue[], pathPrefix: string): void {
	if (value === undefined) return;
	if (!isPlainObject(value)) {
		issues.push({ path: pathPrefix, message: "must be an object" });
		return;
	}

	const daemonStatus = value as Record<string, unknown>;
	for (const key of Object.keys(daemonStatus)) {
		if (!DAEMON_STATUS_KEYS.has(key)) {
			issues.push({ path: `${pathPrefix}.${key}`, message: `unknown key "${key}"` });
		}
	}

	const status = daemonStatus["status"];
	if (status !== "running" && status !== "stopped") {
		issues.push({ path: `${pathPrefix}.status`, message: "must be \"running\" or \"stopped\"" });
	}

	const pid = daemonStatus["pid"];
	if (pid !== undefined && (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0)) {
		issues.push({ path: `${pathPrefix}.pid`, message: "must be an integer >= 1" });
	}

	const lastTickAt = daemonStatus["last_tick_at"];
	if (lastTickAt !== undefined && (typeof lastTickAt !== "string" || lastTickAt.trim() === "")) {
		issues.push({ path: `${pathPrefix}.last_tick_at`, message: "must be a non-empty string" });
	}

	const runId = daemonStatus["run_id"];
	if (runId !== undefined && (typeof runId !== "string" || runId.trim() === "")) {
		issues.push({ path: `${pathPrefix}.run_id`, message: "must be a non-empty string" });
	}
}

function optionalPositiveInt(
	doc: Record<string, unknown>,
	key: string,
	issues: FactoryRegistryIssue[],
	pathOverride?: string,
): void {
	const value = doc[key];
	if (value === undefined) return;
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
		issues.push({ path: pathOverride ?? key, message: "must be an integer >= 1" });
	}
}

function looksLikeRepoOrPath(value: string): boolean {
	const trimmed = value.trim();
	if (trimmed.startsWith(".") || trimmed.startsWith("/") || trimmed.startsWith("~")) return true;
	return trimmed.includes("/");
}

function isRelativePath(value: string): boolean {
	if (value.startsWith("~")) return false;
	return !isAbsolute(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
