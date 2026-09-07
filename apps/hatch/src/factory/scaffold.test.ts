import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { scaffoldFactory } from "./scaffold.js";

describe("scaffoldFactory", () => {
	it("renders templates, placeholder directories, and policy-pack assets", () => {
		const root = mkdtempSync(join(tmpdir(), "factory-scaffold-"));
		const templateRoot = join(root, "factories", "_templates", "factory");
		const policyPackTemplateRoot = join(root, "factories", "_templates", "policy-pack", "v1");
		mkdirSync(join(templateRoot, "scripts"), { recursive: true });
		mkdirSync(join(templateRoot, "scenarios", "__FACTORY_ID__"), { recursive: true });
		mkdirSync(join(templateRoot, "docs"), { recursive: true });
		mkdirSync(join(templateRoot, "conformance", "fixtures"), { recursive: true });
		mkdirSync(policyPackTemplateRoot, { recursive: true });

		writeFileSync(
			join(templateRoot, "factory.config.json.template"),
			"{\"factory_id\":\"{{factory_id}}\",\"target_repo\":\"{{target_repo}}\",\"control_plane_repo\":\"{{control_plane_repo}}\",\"tracking_issue\":\"{{tracking_issue_url}}\",\"skills\":{\"supervisor\":\"packages/factory-skills/skills/runtime/supervisor_review/SKILL.md\"},\"conformance\":{\"entrypoint\":\"factories/{{factory_id}}/scripts/run-conformance.sh\",\"fixtures\":\"factories/{{factory_id}}/conformance/fixtures\",\"runs_dir\":\"{{runs_dir}}\"}}",
		);
		writeFileSync(
			join(templateRoot, "roles.stylesheet.template"),
			".reviewer { llm_provider = \"openrouter\"; llm_model = \"openai/gpt-5.3-codex\"; trust_domain = \"{{trust_domain}}\" }\n",
		);
		writeFileSync(join(templateRoot, "scripts", "factory_daemon.sh.template"), "#!/usr/bin/env bash\necho {{factory_id}}\n");
		writeFileSync(
			join(templateRoot, "docs", "factory-create-evolve.md.template"),
			"skill=docs/skills/factory-create-evolve/SKILL.md\ntarget_repo={{target_repo}}\ninit=hatch factory init --id {{factory_id}} --repo {{target_repo}} --control-plane {{control_plane_repo}}\nmanifest=factories/{{factory_id}}/inventory/factory-composition-manifest.v1.json\npnpm test -- apps/hatch/src/factory/conformance-harness.test.ts\ndocs/skills/factory-authoring/policy-pack.md\n## Validation evidence\n## Common failure modes and repair\n",
		);
		writeFileSync(join(templateRoot, "INTENT.md.template"), "# {{factory_name}} / {{target_repo}}\n");
		writeFileSync(join(templateRoot, "conformance", "README.md.template"), "run=factories/{{factory_id}}/scripts/run-conformance.sh\n");
		writeFileSync(join(templateRoot, "conformance", "fixtures", "ops-contract.json.template"), "{\"factory\":\"{{factory_id}}\",\"runs_dir\":\"{{runs_dir}}\"}\n");
		writeFileSync(join(templateRoot, "scripts", "run-conformance.sh.template"), "#!/usr/bin/env bash\nexport HATCH_CONFORMANCE_FIXTURES=/tmp/fixtures\n");
		writeFileSync(join(templateRoot, "scenarios", "__FACTORY_ID__", ".gitkeep.template"), "");

		writeFileSync(
			join(policyPackTemplateRoot, "metadata.json"),
			JSON.stringify({ version: "v1", owned_by: "factory-platform" }, null, 2),
		);
		writeFileSync(join(policyPackTemplateRoot, "supervisor-policy.json"), JSON.stringify({ shared: { retries: 2 } }, null, 2));

		const result = scaffoldFactory({
			rootDir: root,
			templateRoot,
			policyPackTemplateRoot,
			factoryId: "test-factory",
			values: {
				factory_id: "test-factory",
				factory_name: "Test Factory",
				target_repo: "example-org/test-repo",
				control_plane_repo: "recallnet/astrochicken",
				tracking_issue_url: "https://github.com/example-org/test-repo/issues/42",
				dispatch_graph: "factories/test-factory/graphs/factory_supervisor_tick.dot",
				trust_domain: "test-factory.local",
				provider: "openrouter",
				model: "openai/gpt-5.3-codex",
				runs_dir: ".hatch/test-factory/runs",
			},
		});

		expect(result.writtenFiles).toContain("factories/test-factory/factory.config.json");
		expect(result.writtenFiles).toContain("factories/test-factory/scripts/factory_daemon.sh");
		expect(result.writtenFiles).toContain("factories/test-factory/INTENT.md");
		expect(result.writtenFiles).toContain("factories/test-factory/roles.stylesheet");
		expect(result.writtenFiles).toContain("factories/test-factory/scenarios/test-factory/.gitkeep");
		expect(result.writtenFiles).toContain("factories/test-factory/docs/factory-create-evolve.md");
		expect(result.writtenFiles).toContain("factories/test-factory/conformance/README.md");
		expect(result.writtenFiles).toContain("factories/test-factory/conformance/fixtures/ops-contract.json");
		expect(result.writtenFiles).toContain("factories/test-factory/scripts/run-conformance.sh");
		expect(result.writtenFiles).toContain("factories/test-factory/policy-pack/v1/metadata.json");
		expect(result.writtenFiles).toContain("factories/test-factory/policy-pack/v1/supervisor-policy.json");

		const config = readFileSync(join(root, "factories", "test-factory", "factory.config.json"), "utf8");
		expect(config).toContain("\"factory_id\":\"test-factory\"");
		expect(config).toContain("\"target_repo\":\"example-org/test-repo\"");
		expect(config).toContain("\"tracking_issue\":\"https://github.com/example-org/test-repo/issues/42\"");
		expect(config).toContain("\"skills\":{\"supervisor\":\"packages/factory-skills/skills/runtime/supervisor_review/SKILL.md\"}");
		expect(config).toContain("\"conformance\":{\"entrypoint\":\"factories/test-factory/scripts/run-conformance.sh\"");

		const roles = readFileSync(join(root, "factories", "test-factory", "roles.stylesheet"), "utf8");
		expect(roles).toContain('llm_provider = "openrouter"');
		expect(roles).toContain('llm_model = "openai/gpt-5.3-codex"');
		expect(roles).toContain('trust_domain = "test-factory.local"');

		const metadata = readFileSync(join(root, "factories", "test-factory", "policy-pack", "v1", "metadata.json"), "utf8");
		expect(metadata).toContain("\"version\": \"v1\"");

		const createEvolveDoc = readFileSync(join(root, "factories", "test-factory", "docs", "factory-create-evolve.md"), "utf8");
		expect(createEvolveDoc).toContain("docs/skills/factory-create-evolve/SKILL.md");
		expect(createEvolveDoc).toContain("hatch factory init --id test-factory");
		expect(createEvolveDoc).toContain("target_repo=example-org/test-repo");
		expect(createEvolveDoc).toContain("target_repo=example-org/test-repo");
		expect(createEvolveDoc).toContain("factory-composition-manifest.v1.json");
		expect(createEvolveDoc).toContain("conformance-harness.test.ts");
		expect(createEvolveDoc).toContain("docs/skills/factory-authoring/policy-pack.md");
		expect(createEvolveDoc).toContain("## Validation evidence");
		const intentDoc = readFileSync(join(root, "factories", "test-factory", "INTENT.md"), "utf8");
		expect(intentDoc).toContain("Test Factory");
		expect(intentDoc).toContain("example-org/test-repo");
	});
});
