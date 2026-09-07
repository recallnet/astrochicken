import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { normalizeServiceProfile, type ServiceProfile } from "./service-profile.js";

interface RegistryGraph {
	id: string;
	path: string;
}

interface LegacyRegistryEntry {
	id: string;
	instance_id?: string;
	repo: string;
	graphs: RegistryGraph[];
	priority?: number;
	concurrency?: {
		max_concurrent_runs?: number;
		max_concurrent_waves?: number;
	};
	daemonStatus?: {
		status: "running" | "stopped";
		pid?: number;
		last_tick_at?: string;
		run_id?: string;
	};
}

interface RegistryInstanceEntry extends ServiceProfile {
	instance_id: string;
	kind_id: string;
	target_repo: string;
	control_plane_repo: string;
	status: string;
	assigned_host_id: string;
	installation_manifest_path?: string;
	graphs: RegistryGraph[];
	daemonStatus?: LegacyRegistryEntry["daemonStatus"];
}

interface RegistryDocument {
	schema: "hatch.factory.registry.v1";
	factories?: LegacyRegistryEntry[];
	instances?: RegistryInstanceEntry[];
}

export interface UpdateFactoryRegistryOptions {
	rootDir?: string;
	factoryId: string;
	instanceId: string;
	targetRepo: string;
	controlPlaneRepo: string;
	dispatchGraphPath: string;
}

function loadRegistry(filePath: string): RegistryDocument {
	if (!existsSync(filePath)) {
		return {
			schema: "hatch.factory.registry.v1",
			factories: [],
			instances: [],
		};
	}

	const parsed = JSON.parse(readFileSync(filePath, "utf8")) as RegistryDocument;
	if (parsed.schema !== "hatch.factory.registry.v1") {
		throw new Error(`invalid factory registry document at ${filePath}`);
	}
	return {
		schema: parsed.schema,
		factories: Array.isArray(parsed.factories) ? parsed.factories : [],
		instances: Array.isArray(parsed.instances) ? parsed.instances : [],
	};
}

function normalizeInstanceRow(entry: RegistryInstanceEntry): RegistryInstanceEntry {
	const serviceProfile = normalizeServiceProfile({
		service_tier: entry.service_tier,
		scheduler_weight: entry.scheduler_weight,
		reserved_capacity: entry.reserved_capacity,
		upgrade_channel: entry.upgrade_channel,
		allowed_runtime_version: entry.allowed_runtime_version,
		support_owner: entry.support_owner,
		feature_flags: entry.feature_flags,
	});

	return {
		instance_id: entry.instance_id,
		kind_id: entry.kind_id,
		target_repo: entry.target_repo,
		control_plane_repo: entry.control_plane_repo,
		status: entry.status,
		assigned_host_id: entry.assigned_host_id,
		installation_manifest_path: entry.installation_manifest_path,
		graphs: entry.graphs,
		daemonStatus: entry.daemonStatus,
		...serviceProfile,
	};
}

export function updateFactoryRegistry(options: UpdateFactoryRegistryOptions): { path: string; entry: RegistryInstanceEntry } {
	const rootDir = resolve(options.rootDir ?? process.cwd());
	const registryPath = join(rootDir, "factory-registry.json");
	const registry = loadRegistry(registryPath);

	const defaultGraphs: RegistryGraph[] = [
		{
			id: "factory_supervisor_tick",
			path: options.dispatchGraphPath,
		},
	];

	const legacyIndex = registry.factories!.findIndex((entry) => entry.id === options.factoryId);
	const currentLegacy = legacyIndex === -1 ? null : registry.factories![legacyIndex];
	if (legacyIndex === -1) {
		registry.factories!.push({
			id: options.factoryId,
			instance_id: options.instanceId,
			repo: options.targetRepo,
			graphs: defaultGraphs,
			daemonStatus: { status: "stopped" },
		});
	} else {
		const current = registry.factories![legacyIndex];
		registry.factories![legacyIndex] = {
			...current,
			instance_id: options.instanceId,
			repo: options.targetRepo,
			graphs: current.graphs?.length ? current.graphs : defaultGraphs,
			daemonStatus: current.daemonStatus ?? { status: "stopped" },
		};
	}

	const instanceIndex = registry.instances!.findIndex((entry) => entry.instance_id === options.instanceId);
	if (instanceIndex === -1) {
		registry.instances!.push(normalizeInstanceRow({
			instance_id: options.instanceId,
			kind_id: options.factoryId,
			target_repo: options.targetRepo,
			control_plane_repo: options.controlPlaneRepo,
			status: "registered",
			assigned_host_id: "unassigned",
			graphs: currentLegacy?.graphs?.length ? currentLegacy.graphs : defaultGraphs,
			daemonStatus: currentLegacy?.daemonStatus ?? { status: "stopped" },
			...normalizeServiceProfile(),
		}));
	} else {
		const current = registry.instances![instanceIndex];
		registry.instances![instanceIndex] = normalizeInstanceRow({
			...current,
			instance_id: options.instanceId,
			kind_id: current.kind_id || options.factoryId,
			target_repo: options.targetRepo,
			control_plane_repo: options.controlPlaneRepo,
			graphs: current.graphs?.length ? current.graphs : defaultGraphs,
			status: current.status || "registered",
			assigned_host_id: current.assigned_host_id || "unassigned",
			daemonStatus: current.daemonStatus ?? { status: "stopped" },
		});
	}

	registry.instances = registry.instances!.map((entry) => normalizeInstanceRow(entry));
	registry.factories!.sort((a, b) => a.id.localeCompare(b.id));
	registry.instances!.sort((a, b) => a.instance_id.localeCompare(b.instance_id));
	writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);

	const entry = registry.instances!.find((item) => item.instance_id === options.instanceId)!;
	return { path: registryPath, entry };
}
