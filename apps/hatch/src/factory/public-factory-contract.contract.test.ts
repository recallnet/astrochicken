import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateFactoryConfigDocument } from "./config-schema.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const CONTRACT_PATH = path.join(repoRoot, "docs/contracts/factory-public-contract.v1.json");
const REFERENCE_DOC_PATH = path.join(repoRoot, "docs/reference/factory-public-contract.md");
const MODE_REFERENCE_DOC_PATH = path.join(repoRoot, "docs/reference/factory-mode-applicability.md");
const EXTERNAL_ONBOARDING_PATH = path.join(repoRoot, "docs/runbooks/external-factory-operator-onboarding.md");
const HOST_LIFECYCLE_DOC_PATH = path.join(repoRoot, "docs/host-lifecycle.md");
const TEMPLATE_DOC_PATH = path.join(repoRoot, "factories/_templates/factory/docs/factory-create-evolve.md.template");
const TEMPLATE_CONFIG_PATH = path.join(repoRoot, "factories/_templates/factory/factory.config.json.template");
const TEMPLATE_CONFORMANCE_PATH = path.join(repoRoot, "factories/_templates/factory/conformance/README.md.template");
const EXTERNAL_EXAMPLES_INDEX_PATH = path.join(repoRoot, "docs/examples/external-factories.md");
const ACME_EXAMPLE_README_PATH = path.join(repoRoot, "examples/external-factories/acme-support/README.md");
const FACTORY_OPS_CLI_USAGE_PATH = path.join(repoRoot, "packages/factory-ops/src/lib/cli-usage.ts");

type ContractSection = {
	name: string;
	required?: string[];
	optional?: string[];
	managed_only?: string[];
	invariants?: string[];
	forbidden_legacy_keys?: string[];
};

type ModeApplicability = "standalone" | "managed" | "both";

type FactoryPublicContractDocument = {
	schema: string;
	version: string;
	mode_applicability_schema?: {
		allowed_modes: ModeApplicability[];
		key_families?: Record<string, string>;
		validation?: string[];
	};
	mode_applicability?: Record<string, ModeApplicability>;
	sections: ContractSection[];
};

function readContract(): FactoryPublicContractDocument {
	return JSON.parse(readFileSync(CONTRACT_PATH, "utf8")) as FactoryPublicContractDocument;
}

function readSection(doc: FactoryPublicContractDocument, name: string): ContractSection {
	const section = doc.sections.find((entry) => entry.name === name);
	expect(section, `missing contract section: ${name}`).toBeTruthy();
	return section as ContractSection;
}

function readModeApplicability(doc: FactoryPublicContractDocument): Record<string, ModeApplicability> {
	expect(doc.mode_applicability, "missing mode_applicability").toBeTruthy();
	return doc.mode_applicability as Record<string, ModeApplicability>;
}

function expectedModeLabel(mode: ModeApplicability): string {
	if (mode === "managed") return "mode: managed-only";
	if (mode === "standalone") return "mode: standalone-only";
	return "mode: both (standalone + managed)";
}

function validFactoryConfig(): Record<string, unknown> {
	return {
		schema: "hatch.factory.config.v1",
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
		runs_dir: ".hatch/test-factory/runs",
		trust: {
			domain: "test-factory.local",
			roles: ["test-factory.local.tool", "test-factory.local.codergen"],
		},
	};
}

describe("factory public contract", () => {
	it("publishes canonical schema and section surface", () => {
		const contract = readContract();
		expect(contract.schema).toBe("factory-public-contract.v1");
		expect(contract.version).toBe("v1");

		expect(contract.sections.map((section) => section.name)).toEqual([
			"config",
			"graphs",
			"scenarios",
			"policy_packs",
			"conformance",
			"runs",
			"managed_extensions",
		]);
	});

	it("pins required config keys to runtime validation behavior", () => {
		const contract = readContract();
		const configSection = readSection(contract, "config");

		const requiredKeys = [
			"schema",
			"factory_id",
			"control_plane_repo",
			"dispatch.graph",
			"pipeline.supervisor_tick",
			"skills.supervisor",
			"scenarios.root",
			"runs_dir",
			"trust.domain",
			"trust.roles",
		];

		expect(configSection.required ?? []).toEqual(expect.arrayContaining(requiredKeys));

		const cases: Array<{ key: string; mutate: (doc: Record<string, unknown>) => void; issuePath: string }> = [
			{ key: "schema", mutate: (doc) => { delete doc.schema; }, issuePath: "schema" },
			{ key: "factory_id", mutate: (doc) => { delete doc.factory_id; }, issuePath: "factory_id" },
			{ key: "control_plane_repo", mutate: (doc) => { delete doc.control_plane_repo; }, issuePath: "control_plane_repo" },
			{ key: "dispatch.graph", mutate: (doc) => { doc.dispatch = {}; }, issuePath: "dispatch.graph" },
			{ key: "pipeline.supervisor_tick", mutate: (doc) => { doc.pipeline = {}; }, issuePath: "pipeline.supervisor_tick" },
			{ key: "skills.supervisor", mutate: (doc) => { doc.skills = {}; }, issuePath: "skills.supervisor" },
			{ key: "scenarios.root", mutate: (doc) => { doc.scenarios = {}; }, issuePath: "scenarios.root" },
			{ key: "runs_dir", mutate: (doc) => { delete doc.runs_dir; }, issuePath: "runs_dir" },
			{ key: "trust.domain", mutate: (doc) => { doc.trust = { roles: ["test-factory.local.tool"] }; }, issuePath: "trust.domain" },
			{ key: "trust.roles", mutate: (doc) => { doc.trust = { domain: "test-factory.local", roles: [] }; }, issuePath: "trust.roles" },
		];

		for (const testCase of cases) {
			const doc = validFactoryConfig();
			testCase.mutate(doc);
			const issues = validateFactoryConfigDocument(doc);
			expect(issues.some((issue) => issue.path === testCase.issuePath), `${testCase.key} should be validated`).toBe(true);
		}
	});

	it("documents managed-only config fields guarded by managed validation logic", () => {
		const contract = readContract();
		const configSection = readSection(contract, "config");

		const managedOnly = [
			"managed",
			"kind_id",
			"instance_id",
			"destinations",
			"upstream_repo",
			"work_dir",
			"upstream_bug_labels",
			"slack_webhook_url",
			"canonical_checkout_path",
			"schedules",
		];
		expect(configSection.managed_only ?? []).toEqual(expect.arrayContaining(managedOnly));

		const managedCases: Array<{ key: string; apply: (doc: Record<string, unknown>) => void; issuePath: string }> = [
			{ key: "managed", apply: (doc) => { doc.managed = "true"; }, issuePath: "managed" },
			{ key: "kind_id", apply: (doc) => { doc.kind_id = "BAD_KIND"; }, issuePath: "kind_id" },
			{ key: "instance_id", apply: (doc) => { doc.instance_id = ""; }, issuePath: "instance_id" },
			{ key: "destinations", apply: (doc) => { doc.destinations = { platform_incidents: { repo: "recallnet" } }; }, issuePath: "destinations.platform_incidents.repo" },
			{ key: "upstream_repo", apply: (doc) => { doc.upstream_repo = "recallnet"; }, issuePath: "upstream_repo" },
			{ key: "work_dir", apply: (doc) => { doc.work_dir = ""; }, issuePath: "work_dir" },
			{ key: "upstream_bug_labels", apply: (doc) => { doc.upstream_bug_labels = [""]; }, issuePath: "upstream_bug_labels[0]" },
			{ key: "slack_webhook_url", apply: (doc) => { doc.slack_webhook_url = 1; }, issuePath: "slack_webhook_url" },
			{ key: "canonical_checkout_path", apply: (doc) => { doc.canonical_checkout_path = 1; }, issuePath: "canonical_checkout_path" },
			{ key: "schedules", apply: (doc) => { doc.schedules = { jobs: [] }; }, issuePath: "schedules.jobs" },
		];

		for (const testCase of managedCases) {
			const doc = validFactoryConfig();
			testCase.apply(doc);
			const issues = validateFactoryConfigDocument(doc);
			expect(issues.some((issue) => issue.path === testCase.issuePath), `${testCase.key} should be validated`).toBe(true);
		}

		const managedMissingUpstream = {
			...validFactoryConfig(),
			managed: true,
		};
		const managedIssues = validateFactoryConfigDocument(managedMissingUpstream);
		expect(managedIssues.some((issue) => issue.path === "upstream_repo" && /required/.test(issue.message))).toBe(true);
	});

	it("requires target_repo and forbids legacy aliases", () => {
		const contract = readContract();
		const configSection = readSection(contract, "config");

		expect(configSection.required ?? []).toEqual(expect.arrayContaining(["target_repo"]));
		expect(configSection.optional ?? []).toEqual(expect.arrayContaining([
			"dispatch.latency_slo_seconds",
			"pipeline.maintenance_interval_seconds",
		]));
		expect(configSection.forbidden_legacy_keys ?? []).toEqual(expect.arrayContaining(["repo", "control_plane"]));

		const allConfigKeys = [
			...(configSection.required ?? []),
			...(configSection.optional ?? []),
			...(configSection.managed_only ?? []),
		];
		expect(allConfigKeys).not.toContain("repo");
		expect(allConfigKeys).not.toContain("control_plane");
		expect(allConfigKeys).not.toContain("home_repo");

		const missingIdentity = validFactoryConfig();
		delete missingIdentity.target_repo;
		const missingIdentityIssues = validateFactoryConfigDocument(missingIdentity);
		expect(missingIdentityIssues).toContainEqual({
			path: "target_repo",
			message: "must be a non-empty string",
		});

		const validIdentity = {
			...validFactoryConfig(),
			target_repo: "example-org/target-repo",
		};
		const validIssues = validateFactoryConfigDocument(validIdentity);
		expect(validIssues).toEqual([]);
	});

	it("defines mode applicability with allowed values and config/command coverage", () => {
		const contract = readContract();
		const configSection = readSection(contract, "config");
		const modeSchema = contract.mode_applicability_schema;
		expect(modeSchema, "missing mode_applicability_schema").toBeTruthy();
		expect(modeSchema?.allowed_modes).toEqual(["standalone", "managed", "both"]);

		const modeApplicability = readModeApplicability(contract);
		const allowedModes = new Set(modeSchema?.allowed_modes ?? []);
		for (const [key, value] of Object.entries(modeApplicability)) {
			expect(allowedModes.has(value), `invalid mode for ${key}: ${value}`).toBe(true);
		}

		const configKeys = [
			...(configSection.required ?? []),
			...(configSection.optional ?? []),
			...(configSection.managed_only ?? []),
		].map((key) => `config.${key}`);
		for (const key of configKeys) {
			expect(modeApplicability[key], `missing mode_applicability entry for ${key}`).toBeTruthy();
		}

		const requiredCommandKeys = [
			"command.hatch.run",
			"command.hatch.validate",
			"command.hatch.factory.conformance",
			"command.hatch_ops.factory.status",
			"command.hatch_ops.factory.tick_status",
			"command.hatch_ops.factory.subscribe",
			"command.hatch_ops.factory.host_install",
			"command.hatch_ops.factory.host_start",
			"command.hatch_ops.factory.host_stop",
			"command.hatch_ops.factory.host_restart",
			"command.hatch_ops.factory.host_health",
			"command.hatch_ops.factory.host_version",
			"command.hatch_ops.factory.host_logs",
		];
		for (const key of requiredCommandKeys) {
			expect(modeApplicability[key], `missing mode_applicability entry for ${key}`).toBeTruthy();
		}
	});

	it("keeps operator CLI mode labels aligned with contract metadata", () => {
		const contract = readContract();
		const modeApplicability = readModeApplicability(contract);
		const cliUsage = readFileSync(FACTORY_OPS_CLI_USAGE_PATH, "utf8");

		const commandHelpLines: ReadonlyArray<{ contractKey: string; snippet: string }> = [
			{ contractKey: "command.hatch_ops.factory.status", snippet: "factory status [--factory-id <id>] [--runs-dir .hatch/runs] [--json]" },
			{ contractKey: "command.hatch_ops.factory.tick_status", snippet: "factory tick-status [--factory-id <id>] [--runs-dir .hatch/runs] [--json]" },
			{ contractKey: "command.hatch_ops.factory.subscribe", snippet: "factory subscribe [--factory-id <id>] [--runs-dir .hatch/runs] [--event <types>] [--stream] [--timeout <seconds>] [--run-id <id>]" },
			{ contractKey: "command.hatch_ops.factory.host_install", snippet: "factory host-install --factory-id <id>" },
			{ contractKey: "command.hatch_ops.factory.host_start", snippet: "factory host-start --factory-id <id>" },
			{ contractKey: "command.hatch_ops.factory.host_stop", snippet: "factory host-stop --factory-id <id>" },
			{ contractKey: "command.hatch_ops.factory.host_restart", snippet: "factory host-restart --factory-id <id>" },
			{ contractKey: "command.hatch_ops.factory.host_health", snippet: "factory host-health --factory-id <id>" },
			{ contractKey: "command.hatch_ops.factory.host_version", snippet: "factory host-version --factory-id <id>" },
			{ contractKey: "command.hatch_ops.factory.host_logs", snippet: "factory host-logs --factory-id <id>" },
		];

		for (const { contractKey, snippet } of commandHelpLines) {
			const mode = modeApplicability[contractKey];
			expect(mode, `missing mode_applicability entry for ${contractKey}`).toBeTruthy();
			const line = cliUsage.split("\n").find((entry) => entry.includes(snippet));
			expect(line, `missing CLI usage line for ${contractKey}`).toBeTruthy();
			expect(line ?? "").toContain(expectedModeLabel(mode as ModeApplicability));
		}
	});

	it("keeps canonical doc and onboarding/template surfaces pinned to this contract", () => {
		const referenceDoc = readFileSync(REFERENCE_DOC_PATH, "utf8");
		expect(referenceDoc).toContain("docs/contracts/factory-public-contract.v1.json");
		expect(referenceDoc).toContain("target_repo");
		expect(referenceDoc).toContain("Mode applicability matrix");
		expect(referenceDoc).toContain("hatch-ops factory status");

		const modeReferenceDoc = readFileSync(MODE_REFERENCE_DOC_PATH, "utf8");
		expect(modeReferenceDoc).toContain("mode_applicability");
		expect(modeReferenceDoc).toContain("hatch-ops factory host-install");
		expect(modeReferenceDoc).toContain("hatch-ops factory subscribe");
		expect(modeReferenceDoc).toContain("external-factory-operator-onboarding.md");

		const onboarding = readFileSync(EXTERNAL_ONBOARDING_PATH, "utf8");
		expect(onboarding).toContain("../reference/factory-public-contract.md");
		expect(onboarding).toContain("../contracts/factory-public-contract.v1.json");
		expect(onboarding).toContain("../reference/factory-mode-applicability.md");
		expect(onboarding).toContain("mode_applicability");

		const hostLifecycleDoc = readFileSync(HOST_LIFECYCLE_DOC_PATH, "utf8");
		expect(hostLifecycleDoc).toContain("factory-mode-applicability.md");
		expect(hostLifecycleDoc).toContain("mode_applicability");

		const templateDoc = readFileSync(TEMPLATE_DOC_PATH, "utf8");
		expect(templateDoc).toContain("docs/reference/factory-public-contract.md");
		expect(templateDoc).toContain("docs/contracts/factory-public-contract.v1.json");

		const templateConfig = readFileSync(TEMPLATE_CONFIG_PATH, "utf8");
		expect(templateConfig).toContain('"_contract_ref": "docs/contracts/factory-public-contract.v1.json"');

		const conformanceTemplate = readFileSync(TEMPLATE_CONFORMANCE_PATH, "utf8");
		expect(conformanceTemplate).toContain("docs/reference/factory-public-contract.md");
		expect(conformanceTemplate).toContain("docs/contracts/factory-public-contract.v1.json");

		const externalExamplesIndex = readFileSync(EXTERNAL_EXAMPLES_INDEX_PATH, "utf8");
		expect(externalExamplesIndex).toContain("../reference/factory-public-contract.md");
		expect(externalExamplesIndex).toContain("../contracts/factory-public-contract.v1.json");

		const acmeExampleReadme = readFileSync(ACME_EXAMPLE_README_PATH, "utf8");
		expect(acmeExampleReadme).toContain("../../../docs/reference/factory-public-contract.md");
		expect(acmeExampleReadme).toContain("../../../docs/contracts/factory-public-contract.v1.json");
	});
});
