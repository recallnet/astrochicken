import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
	FACTORY_CONFIG_BOUNDARY_SCHEMA,
	FACTORY_CONFIG_SCHEMA_VERSION,
	FACTORY_INSTALLATION_MANIFEST_BOUNDARY_SCHEMA,
	FACTORY_INSTALLATION_WORKSPACE_MODES,
	FACTORY_INSTANCE_MANIFEST_BOUNDARY_SCHEMA,
	FACTORY_KIND_DEFINITION_BOUNDARY_SCHEMA,
	FACTORY_KIND_EXECUTION_MODES,
	FACTORY_SERVICE_REGISTRY_BOUNDARY_SCHEMA,
	GOAL_DECOMPOSITION_TIMEOUT_DEFAULTS,
	GOAL_DECOMPOSITION_TIMEOUT_OVERRIDES_ROOT_KEY_PATH,
	GOAL_DECOMPOSITION_TIMEOUT_STAGES,
	assertFactoryIsolationContext,
	formatFactoryConfigIssue,
	formatPolicyPackIssue,
	getFactoryIsolationConfig,
	parseFactoryConfigDocument,
	parseFactoryInstallationManifestDocument,
	parseFactoryInstanceManifestDocument,
	parseFactoryKindDefinitionDocument,
	parseFactoryServiceRegistryDocument,
	resolveFactoryRuntimePaths,
	resolveGoalDecompositionTimeouts,
	validateFactoryConfigDocument,
	validateFactoryInstallationManifestDocument,
	validateFactoryInstanceManifestDocument,
	validateFactoryKindDefinitionDocument,
	validateFactoryServiceRegistryDocument,
	validatePolicyPackContract,
	type PolicyPackMetadataDocument,
} from "./config-schema.js";
import { HATCH_BOUNDARY_SCHEMA_REGISTRY } from "./boundary-schema-registry.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");

function validFactoryConfig(): Record<string, unknown> {
	return {
		schema: FACTORY_CONFIG_SCHEMA_VERSION,
		factory_id: "test-factory",
		target_repo: "example-org/test-repo",
		control_plane_repo: "recallnet/astrochicken",
		dispatch: {
			graph: "docs/contracts/workflow-ir/capability-wave-dispatch/wave_dispatch.dot",
			latency_slo_seconds: 15,
		},
		skills: {
			supervisor: "packages/factory-skills/skills/runtime/supervisor_review/SKILL.md",
		},
		scenarios: {
			root: "factories/test-factory/scenarios/test-factory",
		},
		pipeline: {
			supervisor_tick: "factories/test-factory/graphs/factory_supervisor_tick.dot",
			maintenance_interval_seconds: 300,
		},
		conformance: {
			entrypoint: "factories/test-factory/scripts/run-conformance.sh",
			fixtures: "factories/test-factory/conformance/fixtures",
			smoke_graph: "factories/test-factory/conformance/factory_supervisor_tick.dot",
			runs_dir: ".hatch/test-factory/runs",
		},
		runs_dir: ".hatch/test-factory/runs",
		policyPack: {
			version: "v1",
			overrides: {},
		},
		trust: {
			domain: "test-factory.local",
			roles: ["test-factory.local.tool", "test-factory.local.codergen"],
		},
		capabilities: {
			goal_decomposition: {
				timeouts: {
					issue_draft: "30m",
					issue_repair: "30m",
					issue_judge: "30m",
					issue_revise: "30m",
				},
			},
			demo: {
				policy: "auto",
			},
		},
		schedules: {
			jobs: [
				{
					id: "daily-lens",
					type: "graph",
					graph: "factories/mothership/graphs/daily_lens_publish.dot",
					cron: "30 8 * * *",
					time_zone: "America/Denver",
					report_window_hours: 24,
					repo: "recallnet/astrochicken",
					output_dir: "reports/lens",
					notify_slack: true,
					issue_labels: ["daily-lens", "report"],
				},
			],
		},
	};
}

function validFactoryKindDefinition(): Record<string, unknown> {
	return {
		kind_id: "brainstorm",
		schema_version: 1,
		managed: true,
		execution_mode: "issues_only",
		shared_supervisor_shell: "docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot",
		domain_graph: "docs/contracts/workflow-ir/brainstorm/domain_brainstorm.dot",
		capabilities: [{ id: "@hatch/capability-brainstorming", channel: "stable" }],
		supported_destinations: ["goal_issues", "platform_incidents"],
		required_labels: ["hatch:intake", "hatch:done"],
	};
}

function validFactoryInstanceManifest(): Record<string, unknown> {
	return {
		instance_id: "fac_01JQ7M8JABCDEFG",
		kind_id: "brainstorm",
		target_repo: {
			provider: "github",
			repo_id: "R_kgDOExample",
			full_name: "example-org/brainstorm-lab",
		},
		control_plane_repo: "recallnet/astrochicken",
		intake: {
			issue_selector: { labels: ["hatch:intake"] },
		},
		destinations: {
			goal_issues: {
				repo: "recallnet/astrochicken",
				labels: ["goal", "source:brainstorm"],
			},
		},
	};
}

function validFactoryServiceRegistry(): Record<string, unknown> {
	return {
		instances: [
			{
				instance_id: "fac_01JQ7M8JABCDEFG",
				kind_id: "brainstorm",
				target_repo: "example-org/brainstorm-lab",
				control_plane_repo: "recallnet/astrochicken",
				status: "active",
				assigned_host_id: "host_devrel_mac_01",
				service_tier: "gold",
				scheduler_weight: 2,
				reserved_capacity: 1,
				upgrade_channel: "stable",
				allowed_runtime_version: ">=1.0.0 <2.0.0",
				support_owner: "factory-platform",
				feature_flags: {
					wave_autoretry: "enabled",
				},
			},
		],
	};
}

function validFactoryInstallationManifest(): Record<string, unknown> {
	return {
		installation_id: "inst_01JQ7ME8ABCDEFG",
		instance_id: "fac_01JQ7M8JABCDEFG",
		host_id: "host_devrel_mac_01",
		workspace_mode: "api_only",
		work_dir: null,
		log_dir: "~/.hatch-hosts/installations/fac_01JQ7M8JABCDEFG/logs",
	};
}

function validPolicyPackMetadata(): PolicyPackMetadataDocument {
	return {
		version: "v1",
		owned_by: "factory-platform",
		files: {
			supervisor: "supervisor-policy.json",
			review: "reviewer-policy.json",
		},
		required_keys: {
			supervisor: ["shared.max_review_retries"],
			review: ["shared.verdict_schema.required_fields", "shared.review.visual_refinement.required_metadata"],
		},
		customizable_keys: {
			supervisor: ["factory.max_review_retries"],
			review: [
				"factory.qa.required_command",
				"factory.qa.visual_refinement.required_command",
				"factory.qa.visual_refinement.additional_evidence",
			],
		},
	};
}

function validPolicyPackPolicies(): Record<string, unknown> {
	return {
		supervisor: {
			shared: { max_review_retries: 2 },
			factory: { max_review_retries: 3 },
		},
		review: {
			shared: {
				verdict_schema: { required_fields: ["status"] },
				review: { visual_refinement: { required_metadata: ["visual_risk_class"] } },
			},
			factory: {
				qa: {
					required_command: "pnpm test",
					visual_refinement: {
						required_command: "npm run qa",
						additional_evidence: ["scenario_root_reference"],
					},
				},
			},
		},
	};
}

describe("factory kind definition schema", () => {
	it("accepts a valid kind definition document", () => {
		const doc = validFactoryKindDefinition();
		expect(validateFactoryKindDefinitionDocument(doc)).toEqual([]);
		expect(parseFactoryKindDefinitionDocument(doc)).toEqual(doc);
	});

	it("rejects missing required keys with deterministic first issue", () => {
		const doc = validFactoryKindDefinition();
		delete doc["kind_id"];
		const issues = validateFactoryKindDefinitionDocument(doc);
		expect(issues[0]).toEqual({ path: "kind_id", message: "must be a non-empty string" });
	});

	it("rejects invalid execution_mode values", () => {
		const doc = validFactoryKindDefinition();
		doc["execution_mode"] = "api";
		const issues = validateFactoryKindDefinitionDocument(doc);
		expect(issues).toContainEqual({
			path: "execution_mode",
			message: `must be one of: ${FACTORY_KIND_EXECUTION_MODES.join(", ")}`,
		});
	});

	it("rejects empty required_labels", () => {
		const doc = validFactoryKindDefinition();
		doc["required_labels"] = [];
		const issues = validateFactoryKindDefinitionDocument(doc);
		expect(issues).toContainEqual({
			path: "required_labels",
			message: "must be a non-empty array of non-empty strings",
		});
	});
});

describe("factory instance manifest schema", () => {
	it("accepts a valid instance manifest document", () => {
		const doc = validFactoryInstanceManifest();
		expect(validateFactoryInstanceManifestDocument(doc)).toEqual([]);
		expect(parseFactoryInstanceManifestDocument(doc)).toEqual(doc);
	});

	it("rejects malformed target_repo.full_name", () => {
		const doc = validFactoryInstanceManifest();
		(doc.target_repo as Record<string, unknown>).full_name = "recallnet";
		const issues = validateFactoryInstanceManifestDocument(doc);
		expect(issues).toContainEqual({ path: "target_repo.full_name", message: "must be owner/repo" });
	});

	it("rejects empty destinations and route repo shape", () => {
		const doc = validFactoryInstanceManifest();
		doc["destinations"] = {};
		const issues = validateFactoryInstanceManifestDocument(doc);
		expect(issues).toContainEqual({ path: "destinations", message: "must define at least one destination route" });
	});

	it("rejects destination routes with invalid repo and labels", () => {
		const doc = validFactoryInstanceManifest();
		doc["destinations"] = {
			goal_issues: {
				repo: "recallnet",
				labels: ["ok", ""],
			},
		};
		const issues = validateFactoryInstanceManifestDocument(doc);
		expect(issues).toContainEqual({ path: "destinations.goal_issues.repo", message: "must be owner/repo" });
		expect(issues).toContainEqual({
			path: "destinations.goal_issues.labels[1]",
			message: "must be a non-empty string",
		});
	});
});

describe("factory service registry schema", () => {
	it("accepts a valid service registry document", () => {
		const doc = validFactoryServiceRegistry();
		expect(validateFactoryServiceRegistryDocument(doc)).toEqual([]);
		expect(parseFactoryServiceRegistryDocument(doc)).toEqual(doc);
	});

	it("rejects identity records missing required fields", () => {
		const doc = validFactoryServiceRegistry();
		delete (doc.instances as Record<string, unknown>[])[0]["assigned_host_id"];
		const issues = validateFactoryServiceRegistryDocument(doc);
		expect(issues).toContainEqual({
			path: "instances[0].assigned_host_id",
			message: "must be a non-empty string",
		});
	});

	it("rejects malformed target_repo owner/repo shape", () => {
		const doc = validFactoryServiceRegistry();
		(doc.instances as Record<string, unknown>[])[0]["target_repo"] = "recallnet";
		const issues = validateFactoryServiceRegistryDocument(doc);
		expect(issues).toContainEqual({ path: "instances[0].target_repo", message: "must be owner/repo" });
	});

	it("rejects invalid service profile metadata values", () => {
		const doc = validFactoryServiceRegistry();
		(doc.instances as Record<string, unknown>[])[0] = {
			instance_id: "fac_01JQ7M8JABCDEFG",
			kind_id: "brainstorm",
			target_repo: "example-org/brainstorm-lab",
			status: "active",
			assigned_host_id: "host_devrel_mac_01",
			service_tier: "tier!",
			scheduler_weight: 0,
			reserved_capacity: -1,
			upgrade_channel: "stable/channel",
			allowed_runtime_version: "v(one)",
			support_owner: "",
			feature_flags: {
				wave_autoretry: "",
			},
		};
		const issues = validateFactoryServiceRegistryDocument(doc);
		expect(issues).toContainEqual({ path: "instances[0].service_tier", message: "must match /^[A-Za-z0-9-]+$/" });
		expect(issues).toContainEqual({ path: "instances[0].scheduler_weight", message: "must be an integer >= 1" });
		expect(issues).toContainEqual({ path: "instances[0].reserved_capacity", message: "must be an integer >= 0" });
		expect(issues).toContainEqual({ path: "instances[0].upgrade_channel", message: "must match /^[A-Za-z0-9-]+$/" });
		expect(issues).toContainEqual({ path: "instances[0].allowed_runtime_version", message: "must be a semver range expression" });
		expect(issues).toContainEqual({ path: "instances[0].support_owner", message: "must be a non-empty string" });
		expect(issues).toContainEqual({ path: "instances[0].feature_flags.wave_autoretry", message: "must be a non-empty string" });
	});

	it("rejects unknown service registry keys", () => {
		const doc = validFactoryServiceRegistry();
		(doc.instances as Record<string, unknown>[])[0]["unexpected"] = true;
		const issues = validateFactoryServiceRegistryDocument(doc);
		expect(issues).toContainEqual({ path: "instances[0].unexpected", message: 'unknown key "unexpected"' });
	});
});

describe("factory installation manifest schema", () => {
	it("accepts api_only installation without work_dir", () => {
		const doc = validFactoryInstallationManifest();
		delete doc["work_dir"];
		expect(validateFactoryInstallationManifestDocument(doc)).toEqual([]);
		expect(parseFactoryInstallationManifestDocument(doc)).toEqual(doc);
	});

	it("rejects invalid workspace_mode values", () => {
		const doc = validFactoryInstallationManifest();
		doc["workspace_mode"] = "none";
		const issues = validateFactoryInstallationManifestDocument(doc);
		expect(issues).toContainEqual({
			path: "workspace_mode",
			message: `must be one of: ${FACTORY_INSTALLATION_WORKSPACE_MODES.join(", ")}`,
		});
	});

	it("requires work_dir for checkout/worktree modes", () => {
		const checkout = validFactoryInstallationManifest();
		checkout["workspace_mode"] = "checkout";
		checkout["work_dir"] = null;
		const checkoutIssues = validateFactoryInstallationManifestDocument(checkout);
		expect(checkoutIssues).toContainEqual({
			path: "work_dir",
			message: "required when workspace_mode is checkout or worktree",
		});

		const worktree = validFactoryInstallationManifest();
		worktree["workspace_mode"] = "worktree";
		delete worktree["work_dir"];
		const worktreeIssues = validateFactoryInstallationManifestDocument(worktree);
		expect(worktreeIssues).toContainEqual({
			path: "work_dir",
			message: "required when workspace_mode is checkout or worktree",
		});
	});

	it("rejects empty work_dir strings", () => {
		const doc = validFactoryInstallationManifest();
		doc["workspace_mode"] = "api_only";
		doc["work_dir"] = "";
		const issues = validateFactoryInstallationManifestDocument(doc);
		expect(issues[0]).toEqual({ path: "work_dir", message: "must be a non-empty string or null" });
	});
});

describe("factory config schema", () => {
	it("accepts a valid v1 document", () => {
		const doc = validFactoryConfig();
		expect(validateFactoryConfigDocument(doc)).toEqual([]);
		expect(parseFactoryConfigDocument(doc)).toEqual(doc);
	});

	it("accepts target_repo for all factory configs", () => {
		const doc = validFactoryConfig();
		doc["target_repo"] = "example-org/example-trading";
		const issues = validateFactoryConfigDocument(doc);
		expect(issues).toEqual([]);
	});

	it("accepts scheduled daemon jobs in factory config", () => {
		const doc = validFactoryConfig();
		expect(validateFactoryConfigDocument(doc)).toEqual([]);
	});

	it("reports missing required fields with deterministic paths", () => {
		const doc = validFactoryConfig();
		delete doc["runs_dir"];
		const issues = validateFactoryConfigDocument(doc);
		expect(issues[0]).toEqual({
			path: "runs_dir",
			message: "must be a non-empty string",
		});
	});

	it("rejects legacy repo aliases when canonical keys are missing", () => {
		const doc = validFactoryConfig();
		delete doc["target_repo"];
		delete doc["control_plane_repo"];
		doc["repo"] = "example-org/test-repo";
		doc["control_plane"] = "recallnet/astrochicken";
		const issues = validateFactoryConfigDocument(doc);
		expect(issues).toContainEqual({ path: "target_repo", message: "must be a non-empty string" });
		expect(issues).toContainEqual({ path: "control_plane_repo", message: "must be a non-empty string" });
		expect(issues).toContainEqual({ path: "repo", message: "unsupported legacy key; use target_repo" });
		expect(issues).toContainEqual({ path: "control_plane", message: "unsupported legacy key; use control_plane_repo" });
	});

	it("rejects legacy goal_decomposition key in favor of capabilities.goal_decomposition", () => {
		const doc = validFactoryConfig();
		doc["goal_decomposition"] = {
			timeouts: {
				issue_draft: "30m",
			},
		};
		const issues = validateFactoryConfigDocument(doc);
		expect(issues).toContainEqual({
			path: "goal_decomposition",
			message: "unsupported legacy key; use capabilities.goal_decomposition",
		});
	});

	it("rejects legacy demo_strategy key in favor of capabilities.demo.policy", () => {
		const doc = validFactoryConfig();
		doc["demo_strategy"] = "terminal";
		const issues = validateFactoryConfigDocument(doc);
		expect(issues).toContainEqual({
			path: "demo_strategy",
			message: "unsupported legacy key; use capabilities.demo.policy",
		});
	});

	it("rejects invalid schema version", () => {
		const doc = validFactoryConfig();
		doc["schema"] = "hatch.factory.config.v0";
		const issues = validateFactoryConfigDocument(doc);
		expect(issues[0]).toEqual({
			path: "schema",
			message: `schema must be "${FACTORY_CONFIG_SCHEMA_VERSION}"`,
		});
	});

	it("rejects malformed factory_id", () => {
		const doc = validFactoryConfig();
		doc["factory_id"] = "BAD_FACTORY";
		const issues = validateFactoryConfigDocument(doc);
		expect(issues).toContainEqual({
			path: "factory_id",
			message: "must match /^[a-z0-9-]+$/",
		});
	});

	it("rejects malformed owner/repo fields", () => {
		const doc = validFactoryConfig();
		doc["target_repo"] = "recallnet";
		doc["control_plane_repo"] = "astrochicken";
		const issues = validateFactoryConfigDocument(doc);
		expect(issues).toContainEqual({ path: "target_repo", message: "must be owner/repo" });
		expect(issues).toContainEqual({ path: "control_plane_repo", message: "must be owner/repo" });
	});

	it("rejects malformed scheduled job repo and cron fields", () => {
		const doc = validFactoryConfig();
		((doc.schedules as Record<string, unknown>).jobs as Record<string, unknown>[])[0] = {
			id: "",
			type: "graph",
			cron: "",
			repo: "recallnet",
		};
		const issues = validateFactoryConfigDocument(doc);
		expect(issues).toContainEqual({ path: "schedules.jobs[0].id", message: "must be a non-empty string" });
		expect(issues).toContainEqual({ path: "schedules.jobs[0].cron", message: "must be a non-empty string" });
		expect(issues).toContainEqual({ path: "schedules.jobs[0].graph", message: "must be a non-empty string when type=graph" });
		expect(issues).toContainEqual({ path: "schedules.jobs[0].repo", message: "must be owner/repo" });
	});

	it("allows dispatch.graph to differ from pipeline.supervisor_tick", () => {
		const doc = validFactoryConfig();
		doc["dispatch"] = { graph: "factories/test-factory/graphs/a.dot" };
		doc["pipeline"] = { supervisor_tick: "factories/test-factory/graphs/b.dot" };
		const issues = validateFactoryConfigDocument(doc);
		expect(issues.some((issue) => issue.path === "dispatch.graph" && /must match pipeline\.supervisor_tick/.test(issue.message))).toBe(false);
	});

	it("rejects trust roles outside the trust domain", () => {
		const doc = validFactoryConfig();
		doc["trust"] = {
			domain: "test-factory.local",
			roles: ["other-domain.tool"],
		};
		const issues = validateFactoryConfigDocument(doc);
		expect(issues).toContainEqual({
			path: "trust.roles[0]",
			message: "must start with \"test-factory.local.\"",
		});
	});

	it("validates conformance section shape when present", () => {
		const doc = validFactoryConfig();
		doc["conformance"] = {
			entrypoint: "",
			fixtures: 1,
			smoke_graph: 2,
			runs_dir: "",
			benchmark_telemetry_warn_only: "true",
			benchmark_telemetry_exemptions: ["", 1],
		};
		const issues = validateFactoryConfigDocument(doc);
		expect(issues).toContainEqual({ path: "conformance.entrypoint", message: "must be a non-empty string" });
		expect(issues).toContainEqual({ path: "conformance.fixtures", message: "must be a non-empty string" });
		expect(issues).toContainEqual({ path: "conformance.smoke_graph", message: "must be a non-empty string" });
		expect(issues).toContainEqual({ path: "conformance.runs_dir", message: "must be a non-empty string" });
		expect(issues).toContainEqual({ path: "conformance.benchmark_telemetry_warn_only", message: "must be a boolean" });
		expect(issues).toContainEqual({ path: "conformance.benchmark_telemetry_exemptions[0]", message: "must be a non-empty string" });
		expect(issues).toContainEqual({ path: "conformance.benchmark_telemetry_exemptions[1]", message: "must be a non-empty string" });
	});

	it("validates policyPack section shape when present", () => {
		const doc = validFactoryConfig();
		doc["policyPack"] = { version: "v1", overrides: "not-an-object" };
		const issues = validateFactoryConfigDocument(doc);
		expect(issues).toContainEqual({ path: "policyPack.overrides", message: "must be an object" });
	});

	it("accepts capabilities.demo.policy enum values", () => {
		for (const policy of ["auto", "terminal", "browser", "none"] as const) {
			const doc = validFactoryConfig();
			doc["capabilities"] = {
				...(doc["capabilities"] as Record<string, unknown>),
				demo: { policy },
			};
			expect(validateFactoryConfigDocument(doc)).toEqual([]);
		}
	});

	it("rejects invalid capabilities.demo.policy values with deterministic path", () => {
		const doc = validFactoryConfig();
		doc["capabilities"] = {
			...(doc["capabilities"] as Record<string, unknown>),
			demo: { policy: "webcam" },
		};
		const issues = validateFactoryConfigDocument(doc);
		expect(issues).toContainEqual({
			path: "capabilities.demo.policy",
			message: "must be one of: auto, terminal, browser, none",
		});
	});

	it("validates capabilities.goal_decomposition timeout overrides when present", () => {
		const doc = validFactoryConfig();
		doc["capabilities"] = {
			goal_decomposition: {
				timeouts: {
					issue_draft: "",
					unknown_stage: "10m",
					issue_judge: "30minutes",
				},
			},
		};
		const issues = validateFactoryConfigDocument(doc);
		expect(issues).toContainEqual({
			path: "capabilities.goal_decomposition.timeouts.issue_draft",
			message: "must be a non-empty string",
		});
		expect(issues).toContainEqual({
			path: "capabilities.goal_decomposition.timeouts.unknown_stage",
			message: `unsupported timeout stage; expected one of ${GOAL_DECOMPOSITION_TIMEOUT_STAGES.join(", ")}`,
		});
		expect(issues).toContainEqual({
			path: "capabilities.goal_decomposition.timeouts.issue_judge",
			message: "must match /^\\d+(ms|s|m|h|d)$/",
		});
	});

	it("resolves goal decomposition timeout defaults through config-schema export surface", () => {
		const resolved = resolveGoalDecompositionTimeouts({});
		expect(resolved.issue_draft.timeout).toBe(GOAL_DECOMPOSITION_TIMEOUT_DEFAULTS.issue_draft);
		expect(resolved.issue_draft.source).toBe("default");
		expect(resolved.issue_draft.source_key_path).toBe("@hatch/capability-goal-decomposition/timeouts.defaults.json.issue_draft");
	});

	it("resolves goal decomposition timeout override through config-schema export surface", () => {
		const resolved = resolveGoalDecompositionTimeouts({
			capabilities: {
				goal_decomposition: {
					timeouts: {
						issue_draft: "45m",
					},
				},
			},
		});
		expect(resolved.issue_draft.timeout).toBe("45m");
		expect(resolved.issue_draft.source).toBe("override");
		expect(resolved.issue_draft.source_key_path).toBe(`${GOAL_DECOMPOSITION_TIMEOUT_OVERRIDES_ROOT_KEY_PATH}.issue_draft`);
		expect(resolved.issue_draft.timeout_ms).toBe(2_700_000);
	});

	it("allows policyPack overrides only for customizable keys", () => {
		const config = parseFactoryConfigDocument({
			...validFactoryConfig(),
			policyPack: {
				version: "v1",
				overrides: {
					supervisor: {
						factory: {
							max_review_retries: 4,
						},
					},
				},
			},
		});

		const issues = validatePolicyPackContract({
			policyPack: config.policyPack!,
			metadata: validPolicyPackMetadata(),
			policies: validPolicyPackPolicies(),
		});
		expect(issues).toEqual([]);
	});

	it("rejects non-positive dispatch latency SLO values", () => {
		const doc = validFactoryConfig();
		doc["dispatch"] = {
			...(doc["dispatch"] as Record<string, unknown>),
			latency_slo_seconds: 0,
		};
		const issues = validateFactoryConfigDocument(doc);
		expect(issues).toContainEqual({
			path: "dispatch.latency_slo_seconds",
			message: "must be a positive integer",
		});
	});

	it("rejects non-positive maintenance interval values", () => {
		const doc = validFactoryConfig();
		doc["pipeline"] = {
			...(doc["pipeline"] as Record<string, unknown>),
			maintenance_interval_seconds: -1,
		};
		const issues = validateFactoryConfigDocument(doc);
		expect(issues).toContainEqual({
			path: "pipeline.maintenance_interval_seconds",
			message: "must be a positive integer",
		});
	});

	it("rejects policyPack version mismatch, missing required keys, and forbidden overrides", () => {
		const config = parseFactoryConfigDocument({
			...validFactoryConfig(),
			policyPack: {
				version: "v2",
				overrides: {
					review: {
						shared: {
							verdict_schema: {
								required_fields: ["status", "summary"],
							},
						},
					},
				},
			},
		});

		const policies = validPolicyPackPolicies();
		delete (policies.supervisor as Record<string, unknown>).shared;

		const issues = validatePolicyPackContract({
			policyPack: config.policyPack!,
			metadata: validPolicyPackMetadata(),
			policies,
		});
		expect(issues).toContainEqual({
			path: "policyPack.version",
			message: "policyPack.version mismatch (expected \"v1\", got \"v2\")",
		});
		expect(issues).toContainEqual({
			path: "policyPack.supervisor",
			message: "required key missing: \"shared.max_review_retries\"",
		});
		expect(issues).toContainEqual({
			path: "policyPack.review",
			message: "overrides forbidden key: \"shared.verdict_schema.required_fields\"",
		});
		expect(formatPolicyPackIssue(issues[0])).toContain("policyPack.");
	});

	it("validates isolation contract when present", () => {
		const doc = validFactoryConfig();
		doc["isolation"] = {
			auth: {
				github: {
					tokenEnvVar: "FACTORY_GITHUB_TOKEN",
					repo: "example-org/test-repo",
					factoryId: "test-factory",
				},
			},
			authStoragePath: "~/.pi/auth-test-factory.json",
			model: { envVar: "HATCH_MODEL" },
			provider: { value: "openrouter" },
			paths: {
				runs: ".hatch/test-factory/runs",
				logs: ".hatch/test-factory/logs",
				tmp: ".hatch/test-factory/tmp",
				cache: ".hatch/test-factory/cache",
			},
		};
		expect(validateFactoryConfigDocument(doc)).toEqual([]);
	});

	it("rejects isolation auth contract without repo", () => {
		const doc = validFactoryConfig();
		doc["isolation"] = {
			auth: {
				github: {
					tokenEnvVar: "FACTORY_GITHUB_TOKEN",
				},
			},
		};

		const issues = validateFactoryConfigDocument(doc);
		expect(issues).toContainEqual({
			path: "isolation.auth.github.repo",
			message: "must be a non-empty string",
		});
	});

	it("rejects isolation model/provider selectors without envVar/value", () => {
		const doc = validFactoryConfig();
		doc["isolation"] = {
			model: {},
		};

		const issues = validateFactoryConfigDocument(doc);
		expect(issues).toContainEqual({
			path: "isolation.model",
			message: "must define at least one of envVar or value",
		});
	});

	it("normalizes isolation config and runtime paths", () => {
		const doc = {
			...validFactoryConfig(),
			isolation: {
				auth: { github: { repo: "example-org/test-repo", tokenEnvVar: " FACTORY_GITHUB_TOKEN " } },
				authStoragePath: " ~/.pi/auth-test-factory.json ",
				paths: { runs: ".hatch/test-factory/runs", logs: "logs", tmp: "tmp", cache: "cache" },
			},
		};
		const isolation = getFactoryIsolationConfig(doc);
		expect(isolation?.auth?.github).toEqual({
			repo: "example-org/test-repo",
			tokenEnvVar: "FACTORY_GITHUB_TOKEN",
			factoryId: undefined,
		});
		expect(isolation?.authStoragePath).toBe("~/.pi/auth-test-factory.json");

		const runtimePaths = resolveFactoryRuntimePaths(isolation, {
			runs: ".hatch/default/runs",
			baseDir: "/tmp/workspace",
		});
		expect(runtimePaths).toEqual({
			runs: "/tmp/workspace/.hatch/test-factory/runs",
			logs: "/tmp/workspace/logs",
			tmp: "/tmp/workspace/tmp",
			cache: "/tmp/workspace/cache",
		});
	});

	it("throws deterministic isolation mismatch diagnostics", () => {
		const isolation = getFactoryIsolationConfig({
			isolation: {
				auth: {
					github: {
						repo: "example-org/test-repo",
						factoryId: "test-factory",
						tokenEnvVar: "FACTORY_GITHUB_TOKEN",
					},
				},
			},
		});
		expect(isolation).toBeTruthy();

		expect(() =>
			assertFactoryIsolationContext({
				isolationConfig: isolation,
				factoryId: "other-factory",
				targetRepo: "example-org/test-repo",
				env: { FACTORY_GITHUB_TOKEN: "" },
			}),
		).toThrow("expected isolation.auth.github.factoryId=test-factory");
		expect(() =>
			assertFactoryIsolationContext({
				isolationConfig: isolation,
				factoryId: "test-factory",
				targetRepo: "example-org/other",
				env: { FACTORY_GITHUB_TOKEN: "x" },
			}),
		).toThrow("expected isolation.auth.github.repo=example-org/test-repo");
		expect(() =>
			assertFactoryIsolationContext({
				isolationConfig: isolation,
				factoryId: "test-factory",
				targetRepo: "example-org/test-repo",
				env: {},
			}),
		).toThrow("missing required env var for isolation.auth.github.tokenEnvVar=FACTORY_GITHUB_TOKEN");
	});

	it("accepts the scaffolded factory config template after rendering placeholders", () => {
		const templatePath = resolve(repoRoot, "factories/_templates/factory/factory.config.json.template");
		const template = readFileSync(templatePath, "utf8");
		const rendered = template
			.replaceAll("{{factory_id}}", "template-factory")
			.replaceAll("{{target_repo}}", "example-org/template")
			.replaceAll("{{control_plane_repo}}", "recallnet/astrochicken")
			.replaceAll("{{tracking_issue_url}}", "https://github.com/example-org/template/issues/1")
			.replaceAll("{{dispatch_graph}}", "factories/template-factory/graphs/factory_supervisor_tick.dot")
			.replaceAll("{{trust_domain}}", "template-factory.local")
			.replaceAll("{{provider}}", "openrouter")
			.replaceAll("{{model}}", "openai/gpt-5.3-codex")
			.replaceAll("{{runs_dir}}", ".hatch/template-factory/runs");

		expect(() => parseFactoryConfigDocument(JSON.parse(rendered))).not.toThrow();
	});

	describe("managed factory config validation", () => {
		it("rejects managed=true when upstream_repo is absent", () => {
			const config = { ...validFactoryConfig(), managed: true };
			const issues = validateFactoryConfigDocument(config);
			expect(issues.some((i) => i.path === "upstream_repo")).toBe(true);
			const match = issues.find((i) => i.path === "upstream_repo");
			expect(match?.message).toMatch(/required/);
		});

		it("accepts example-trading managed factory config shape with all managed fields typed", () => {
			const config = {
				...validFactoryConfig(),
				managed: true,
				upstream_repo: "recallnet/astrochicken",
				work_dir: "/path/to/example-trading",
				upstream_bug_labels: ["managed-factory-bug", "factory:example-trading"],
				slack_webhook_url: "${EXAMPLE_TRADING_SLACK_WEBHOOK_URL}",
			};
			const issues = validateFactoryConfigDocument(config);
			expect(issues).toHaveLength(0);
			const doc = parseFactoryConfigDocument(config);
			expect(doc.managed).toBe(true);
			expect(doc.upstream_repo).toBe("recallnet/astrochicken");
			expect(doc.work_dir).toBe("/path/to/example-trading");
			expect(doc.upstream_bug_labels).toEqual(["managed-factory-bug", "factory:example-trading"]);
			expect(doc.slack_webhook_url).toBe("${EXAMPLE_TRADING_SLACK_WEBHOOK_URL}");
		});

		it("accepts managed=false without upstream_repo", () => {
			const config = { ...validFactoryConfig(), managed: false };
			const issues = validateFactoryConfigDocument(config);
			expect(issues).toHaveLength(0);
		});
	});

	it("accepts example-trading managed factory config shape", () => {
		const replayLabPath = resolve(repoRoot, "factories/example-trading/factory.config.json");
		const replayLabConfig = JSON.parse(readFileSync(replayLabPath, "utf8"));
		expect(validateFactoryConfigDocument(replayLabConfig)).toEqual([]);
		const doc = parseFactoryConfigDocument(replayLabConfig);
		expect(doc.factory_id).toBe("example-trading");
		expect(doc.target_repo).toBe("example-org/example-trading");
	});

	it("rejects non-mothership factories that point scenarios.root at an astrochicken leaf", () => {
		const config = {
			...validFactoryConfig(),
			factory_id: "example-trading",
			target_repo: "example-org/example-trading",
			scenarios: {
				root: "factories/example-trading/scenarios/astrochicken",
			},
		};
		const issues = validateFactoryConfigDocument(config);
		expect(issues).toContainEqual({
			path: "scenarios.root",
			message: 'non-mothership factories must not use an "astrochicken" scenario root leaf',
		});
	});

	it("parse throws the first schema issue", () => {
		const doc = { factory_id: "test-factory" };
		expect(() => parseFactoryConfigDocument(doc)).toThrow("schema: must be a non-empty string");
		expect(formatFactoryConfigIssue({ path: "target_repo", message: "must be owner/repo" })).toBe(
			"target_repo: must be owner/repo",
		);
	});

	it("exports governed boundary schemas through the config and registry surfaces", () => {
		expect(FACTORY_CONFIG_BOUNDARY_SCHEMA.outputPath).toBe("docs/contracts/factory-config.json");
		expect(FACTORY_KIND_DEFINITION_BOUNDARY_SCHEMA.outputPath).toBe("docs/contracts/factory-kind-definition.json");
		expect(FACTORY_INSTANCE_MANIFEST_BOUNDARY_SCHEMA.outputPath).toBe("docs/contracts/factory-instance-manifest.json");
		expect(FACTORY_SERVICE_REGISTRY_BOUNDARY_SCHEMA.outputPath).toBe("docs/contracts/factory-service-registry.json");
		expect(FACTORY_INSTALLATION_MANIFEST_BOUNDARY_SCHEMA.outputPath).toBe("docs/contracts/factory-installation-manifest.json");
		expect(HATCH_BOUNDARY_SCHEMA_REGISTRY).toEqual(
			expect.arrayContaining([
				FACTORY_CONFIG_BOUNDARY_SCHEMA,
				FACTORY_KIND_DEFINITION_BOUNDARY_SCHEMA,
				FACTORY_INSTANCE_MANIFEST_BOUNDARY_SCHEMA,
				FACTORY_SERVICE_REGISTRY_BOUNDARY_SCHEMA,
				FACTORY_INSTALLATION_MANIFEST_BOUNDARY_SCHEMA,
			]),
		);
	});
});
