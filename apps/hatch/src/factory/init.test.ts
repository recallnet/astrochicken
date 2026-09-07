import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { initFactory, parseFactoryInitArgs } from "./init.js";

function defaultFactoryConfigTemplate(): string {
	return JSON.stringify({
		schema: "hatch.factory.config.v1",
		factory_id: "{{factory_id}}",
		instance_id: "{{instance_id}}",
		target_repo: "{{target_repo}}",
		control_plane_repo: "{{control_plane_repo}}",
		dispatch: { graph: "{{dispatch_graph}}" },
		skills: { supervisor: "packages/factory-skills/skills/runtime/supervisor_review/SKILL.md" },
		scenarios: { root: "factories/{{factory_id}}/scenarios/{{factory_id}}" },
		pipeline: { supervisor_tick: "{{dispatch_graph}}" },
		runs_dir: "{{runs_dir}}",
		policyPack: {
			version: "v1",
			overrides: {},
		},
		conformance: {
			entrypoint: "factories/{{factory_id}}/scripts/run-conformance.sh",
			fixtures: "factories/{{factory_id}}/conformance/fixtures",
			runs_dir: "{{runs_dir}}",
		},
		trust: {
			domain: "{{trust_domain}}",
			roles: ["{{trust_domain}}.tool", "{{trust_domain}}.codergen"],
		},
	}) + "\n";
}

function defaultPolicyPackMetadata(): Record<string, unknown> {
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

function defaultPolicyPackFiles(): Record<string, unknown> {
	return {
		"supervisor-policy.json": {
			shared: { max_review_retries: 2 },
			factory: { max_review_retries: 2 },
		},
		"reviewer-policy.json": {
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

function seedTemplate(
	root: string,
	{
		configTemplate = defaultFactoryConfigTemplate(),
		policyMetadata = defaultPolicyPackMetadata(),
		policyFiles = defaultPolicyPackFiles(),
	}: {
		configTemplate?: string;
		policyMetadata?: Record<string, unknown>;
		policyFiles?: Record<string, unknown>;
	} = {},
) {
	const templateRoot = join(root, "factories", "_templates", "factory");
	const policyPackTemplateRoot = join(root, "factories", "_templates", "policy-pack", "v1");
	mkdirSync(join(templateRoot, "scripts"), { recursive: true });
		mkdirSync(join(templateRoot, "graphs"), { recursive: true });
	mkdirSync(join(templateRoot, "scenarios", "__FACTORY_ID__"), { recursive: true });
	mkdirSync(join(templateRoot, "docs"), { recursive: true });
	mkdirSync(join(templateRoot, "conformance", "fixtures"), { recursive: true });
	mkdirSync(policyPackTemplateRoot, { recursive: true });
	writeFileSync(join(templateRoot, "factory.config.json.template"), configTemplate);
	writeFileSync(join(templateRoot, "scripts", "factory_daemon.sh.template"), "#!/usr/bin/env bash\nexit 0\n");
	writeFileSync(
		join(templateRoot, "docs", "factory-create-evolve.md.template"),
		"skill=docs/skills/factory-create-evolve/SKILL.md\ntarget_repo={{target_repo}}\ninit=hatch factory init --id {{factory_id}} --repo {{target_repo}} --control-plane {{control_plane_repo}}\nmanifest=factories/{{factory_id}}/inventory/factory-composition-manifest.v1.json\n## Validation evidence\n## Common failure modes and repair\n",
	);
	writeFileSync(join(templateRoot, "INTENT.md.template"), "# {{factory_name}} / {{target_repo}}\n");
	writeFileSync(join(templateRoot, "conformance", "README.md.template"), "run=factories/{{factory_id}}/scripts/run-conformance.sh\n");
	writeFileSync(join(templateRoot, "conformance", "fixtures", "ops-contract.json.template"), "{\"factory\":\"{{factory_id}}\",\"runs_dir\":\"{{runs_dir}}\"}\n");
	writeFileSync(join(templateRoot, "scripts", "run-conformance.sh.template"), "#!/usr/bin/env bash\nexport HATCH_CONFORMANCE_FIXTURES=/tmp/fixtures\n");
	writeFileSync(join(templateRoot, "graphs", ".gitkeep.template"), "");
	writeFileSync(join(templateRoot, "scenarios", "__FACTORY_ID__", ".gitkeep.template"), "");

	writeFileSync(join(policyPackTemplateRoot, "metadata.json"), JSON.stringify(policyMetadata, null, 2));
	for (const [relativePath, document] of Object.entries(policyFiles)) {
		writeFileSync(join(policyPackTemplateRoot, relativePath), JSON.stringify(document, null, 2));
	}
}

function writeRegistry(root: string): void {
	writeFileSync(
		join(root, "factory-registry.json"),
		JSON.stringify({ schema: "hatch.factory.registry.v1", factories: [] }, null, 2),
	);
}

function runInit(root: string) {
	return initFactory(
		{
			factoryId: "test-factory",
			repo: "example-org/test-repo",
			controlPlane: "recallnet/astrochicken",
			force: false,
			rootDir: root,
			runsDir: undefined,
		},
		{
			resolveTrackingIssue: () => ({
				url: "https://github.com/example-org/test-repo/issues/100",
				number: 100,
				created: true,
			}),
		},
	);
}

describe("factory init", () => {
	it("parses required args and validates factory id", () => {
		expect(() => parseFactoryInitArgs(["--id", "BAD", "--repo", "a/b", "--control-plane", "c/d"])).toThrow();

		const parsed = parseFactoryInitArgs([
			"--id",
			"test-factory",
			"--repo",
			"example-org/test-repo",
			"--control-plane",
			"recallnet/astrochicken",
		]);
		expect(parsed.factoryId).toBe("test-factory");
		expect(parsed.repo).toBe("example-org/test-repo");
	});

	it("scaffolds files, policy-pack assets, and upserts factory-registry", async () => {
		const root = mkdtempSync(join(tmpdir(), "factory-init-"));
		seedTemplate(root);
		writeRegistry(root);

		const result = await runInit(root);
		const scaffoldedConfig = JSON.parse(readFileSync(join(root, "factories", "test-factory", "factory.config.json"), "utf8"));
		expect(scaffoldedConfig.instance_id).toMatch(/^fac_[0-9A-HJKMNP-TV-Z]{16}$/);
		expect(scaffoldedConfig.target_repo).toBe("example-org/test-repo");
		expect(scaffoldedConfig.control_plane_repo).toBe("recallnet/astrochicken");
		expect(scaffoldedConfig.repo).toBeUndefined();
		expect(scaffoldedConfig.control_plane).toBeUndefined();

		expect(result.writtenFiles).toContain("factories/test-factory/factory.config.json");
		expect(result.writtenFiles).toContain("factories/test-factory/INTENT.md");
		expect(result.writtenFiles).toContain("factories/test-factory/scripts/factory_daemon.sh");
		expect(result.writtenFiles).toContain("factories/test-factory/scenarios/test-factory/.gitkeep");
		expect(result.writtenFiles).toContain("factories/test-factory/docs/factory-create-evolve.md");
		expect(result.writtenFiles).toContain("factories/test-factory/conformance/README.md");
		expect(result.writtenFiles).toContain("factories/test-factory/conformance/fixtures/ops-contract.json");
		expect(result.writtenFiles).toContain("factories/test-factory/scripts/run-conformance.sh");
		expect(result.writtenFiles).toContain("factories/test-factory/policy-pack/v1/metadata.json");
		expect(result.writtenFiles).toContain("factories/test-factory/policy-pack/v1/supervisor-policy.json");
		expect(result.writtenFiles).toContain("factories/test-factory/inventory/factory-composition-manifest.v1.json");

		const createEvolveDoc = readFileSync(join(root, "factories", "test-factory", "docs", "factory-create-evolve.md"), "utf8");
		expect(createEvolveDoc).toContain("docs/skills/factory-create-evolve/SKILL.md");
		expect(createEvolveDoc).toContain("hatch factory init --id test-factory");
		expect(createEvolveDoc).toContain("target_repo=example-org/test-repo");
		expect(createEvolveDoc).toContain("target_repo=example-org/test-repo");
		expect(createEvolveDoc).toContain("factory-composition-manifest.v1.json");
		expect(createEvolveDoc).toContain("## Validation evidence");
		expect(createEvolveDoc).toContain("--repo example-org/test-repo");
		expect(createEvolveDoc).toContain("--control-plane recallnet/astrochicken");
		const conformanceReadme = readFileSync(join(root, "factories", "test-factory", "conformance", "README.md"), "utf8");
		expect(conformanceReadme).toContain("run=factories/test-factory/scripts/run-conformance.sh");
		const conformanceScript = readFileSync(join(root, "factories", "test-factory", "scripts", "run-conformance.sh"), "utf8");
		expect(conformanceScript).toContain("HATCH_CONFORMANCE_FIXTURES");
		const intentDoc = readFileSync(join(root, "factories", "test-factory", "INTENT.md"), "utf8");
		expect(intentDoc).toContain("Test Factory");
		expect(intentDoc).toContain("example-org/test-repo");

		const registry = JSON.parse(readFileSync(join(root, "factory-registry.json"), "utf8"));
		const entry = registry.factories.find((item: { id: string }) => item.id === "test-factory");
		expect(entry).toBeTruthy();
		expect(entry.instance_id).toBe(scaffoldedConfig.instance_id);
		expect(entry.repo).toBe("example-org/test-repo");
		expect(entry.daemonStatus).toEqual({ status: "stopped" });
		const instanceEntry = registry.instances.find((item: { instance_id: string }) => item.instance_id === scaffoldedConfig.instance_id);
		expect(instanceEntry).toMatchObject({
			target_repo: "example-org/test-repo",
			service_tier: "standard",
			scheduler_weight: 1,
			reserved_capacity: 0,
			upgrade_channel: "stable",
			allowed_runtime_version: "*",
			support_owner: "ops",
			feature_flags: {},
		});

		const manifest = JSON.parse(readFileSync(join(root, "factories", "test-factory", "inventory", "factory-composition-manifest.v1.json"), "utf8"));
		expect(manifest.factoryId).toBe("test-factory");
		expect(manifest.compositionModel).toBe("thin_composition");
		expect(manifest.policy.policyPackVersion).toBe("v1");
		expect(manifest.bootstrap.readmePath).toBeNull();
		expect(manifest.bootstrap.initCommand).toContain("--repo example-org/test-repo");
		expect(manifest.bootstrap.initCommand).toContain("--control-plane recallnet/astrochicken");
	});

	it("preserves an explicit valid --instance-id override", () => {
		const parsed = parseFactoryInitArgs([
			"--id",
			"test-factory",
			"--instance-id",
			"fac_01JQ7M8JABCDEFG",
			"--repo",
			"example-org/test-repo",
			"--control-plane",
			"recallnet/astrochicken",
		]);
		expect(parsed.instanceId).toBe("fac_01JQ7M8JABCDEFG");
	});

	it("fails closed for an invalid --instance-id", async () => {
		const root = mkdtempSync(join(tmpdir(), "factory-init-invalid-instance-id-"));
		seedTemplate(root);
		writeRegistry(root);

		await expect(initFactory(
			{
				factoryId: "test-factory",
				instanceId: "test-factory",
				repo: "example-org/test-repo",
				controlPlane: "recallnet/astrochicken",
				force: false,
				rootDir: root,
			},
			{
				resolveTrackingIssue: () => ({
					url: "https://github.com/example-org/test-repo/issues/100",
					number: 100,
					created: true,
				}),
			},
		)).rejects.toThrow(/--instance-id must be a valid fac_\* id/);
	});

	it("defaults mothership to the grandfathered instance id", async () => {
		const root = mkdtempSync(join(tmpdir(), "factory-init-mothership-"));
		seedTemplate(root);
		writeRegistry(root);

		const result = await initFactory(
			{
				factoryId: "mothership",
				repo: "recallnet/astrochicken",
				controlPlane: "recallnet/astrochicken",
				force: false,
				rootDir: root,
			},
			{
				resolveTrackingIssue: () => ({
					url: "https://github.com/recallnet/astrochicken/issues/1",
					number: 1,
					created: false,
				}),
			},
		);
		expect(result.instanceId).toBe("mothership");
		const scaffoldedConfig = JSON.parse(readFileSync(join(root, "factories", "mothership", "factory.config.json"), "utf8"));
		expect(scaffoldedConfig.instance_id).toBe("mothership");
	});

	it("allows scaffolded factory config to split dispatch and supervisor graphs", async () => {
		const root = mkdtempSync(join(tmpdir(), "factory-init-invalid-"));
		seedTemplate(
			root,
			{
				configTemplate: JSON.stringify({
					schema: "hatch.factory.config.v1",
					factory_id: "{{factory_id}}",
					instance_id: "{{instance_id}}",
					target_repo: "{{target_repo}}",
					control_plane_repo: "{{control_plane_repo}}",
					dispatch: { graph: "factories/{{factory_id}}/graphs/a.dot" },
					skills: { supervisor: "packages/factory-skills/skills/runtime/supervisor_review/SKILL.md" },
					scenarios: { root: "factories/{{factory_id}}/scenarios/{{factory_id}}" },
					pipeline: { supervisor_tick: "factories/{{factory_id}}/graphs/b.dot" },
					runs_dir: "{{runs_dir}}",
					policyPack: {
						version: "v1",
						overrides: {},
					},
					trust: {
						domain: "{{trust_domain}}",
						roles: ["{{trust_domain}}.tool"],
					},
				}) + "\n",
			},
		);
		writeRegistry(root);

		const result = await runInit(root);
		expect(result.factoryRoot).toBe(join(root, "factories", "test-factory"));
		const scaffoldedConfig = JSON.parse(readFileSync(join(root, "factories", "test-factory", "factory.config.json"), "utf8"));
		expect(scaffoldedConfig.dispatch.graph).toBe("factories/test-factory/graphs/a.dot");
		expect(scaffoldedConfig.pipeline.supervisor_tick).toBe("factories/test-factory/graphs/b.dot");
		expect(scaffoldedConfig.dispatch.graph).not.toBe(scaffoldedConfig.pipeline.supervisor_tick);
	});

	it("fails when policy-pack required keys are missing", async () => {
		const root = mkdtempSync(join(tmpdir(), "factory-init-policy-required-"));
		seedTemplate(root, {
			policyFiles: {
				"supervisor-policy.json": { shared: {}, factory: { max_review_retries: 2 } },
				"reviewer-policy.json": {
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
			},
		});
		writeRegistry(root);

		await expect(runInit(root)).rejects.toThrow(/policyPack\.supervisor: required key missing/);
	});

	it("fails when policy-pack overrides forbidden keys", async () => {
		const root = mkdtempSync(join(tmpdir(), "factory-init-policy-forbidden-"));
		seedTemplate(root, {
			configTemplate: JSON.stringify({
				schema: "hatch.factory.config.v1",
				factory_id: "{{factory_id}}",
				instance_id: "{{instance_id}}",
				target_repo: "{{target_repo}}",
				control_plane_repo: "{{control_plane_repo}}",
				dispatch: { graph: "{{dispatch_graph}}" },
				skills: { supervisor: "packages/factory-skills/skills/runtime/supervisor_review/SKILL.md" },
				scenarios: { root: "factories/{{factory_id}}/scenarios/{{factory_id}}" },
				pipeline: { supervisor_tick: "{{dispatch_graph}}" },
				runs_dir: "{{runs_dir}}",
				policyPack: {
					version: "v1",
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
				trust: {
					domain: "{{trust_domain}}",
					roles: ["{{trust_domain}}.tool", "{{trust_domain}}.codergen"],
				},
			}) + "\n",
		});
		writeRegistry(root);

		await expect(runInit(root)).rejects.toThrow(/policyPack\.review: overrides forbidden key/);
	});
});
