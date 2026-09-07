import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
	FACTORY_CONTEXT_MODE_CONFLICT_ERROR_CODE,
	findNearestFactoryConfigPath,
	resolveFactoryContext,
} from "./context-resolver.js";

const ENV_KEYS = [
	"HATCH_FACTORY_ROOT",
	"FACTORY_ROOT",
	"HATCH_FACTORY_CONFIG_PATH",
	"FACTORY_CONFIG_PATH",
	"HATCH_FACTORY_ID",
	"FACTORY_ID",
	"HATCH_TARGET_REPO",
	"TARGET_REPO",
	"HATCH_GH_REPO",
	"GH_REPO",
	"MOTHERSHIP_REPO",
	"HATCH_CONTROL_PLANE_REPO",
	"CONTROL_PLANE_REPO",
	"HATCH_KIND_ID",
	"KIND_ID",
	"HATCH_INSTANCE_ID",
	"INSTANCE_ID",
	"HATCH_DESTINATIONS_JSON",
	"DESTINATIONS_JSON",
	"HATCH_RUNS_DIR",
	"RUNS_DIR",
	"HATCH_SCENARIOS_ROOT",
	"SCENARIOS_ROOT",
	"HATCH_FACTORY_MODE",
	"FACTORY_MODE",
	"HATCH_FACTORY_GITHUB_TOKEN",
	"FACTORY_GITHUB_TOKEN",
] as const;

const envBackup = new Map<string, string | undefined>();
for (const key of ENV_KEYS) {
	envBackup.set(key, process.env[key]);
}

function resetResolverEnv(): void {
	for (const key of ENV_KEYS) {
		const value = envBackup.get(key);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}

function clearResolverEnv(): void {
	for (const key of ENV_KEYS) delete process.env[key];
}

function writeJson(filePath: string, value: unknown): void {
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, JSON.stringify(value, null, 2));
}

afterEach(() => {
	resetResolverEnv();
});

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");

describe("factory context resolver", () => {
	it("finds nearest config from nested directory", () => {
		const root = mkdtempSync(join(tmpdir(), "hatch-factory-context-nearest-"));
		const factoryRoot = join(root, "factories", "mothership");
		const nested = join(factoryRoot, "graphs", "nested", "deep");
		mkdirSync(nested, { recursive: true });
		const configPath = join(factoryRoot, "factory.config.json");
		writeJson(configPath, {
			schema: "hatch.factory.config.v1",
			factory_id: "mothership",
			target_repo: "recallnet/astrochicken",
			control_plane_repo: "recallnet/astrochicken",
			runs_dir: ".hatch/mothership/runs",
			scenarios: { root: "factories/mothership/scenarios/astrochicken" },
		});

		expect(findNearestFactoryConfigPath({ startDir: nested })).toBe(configPath);
	});

	it("resolves managed identity from .hatch/instance.json when config omits target_repo", () => {
		clearResolverEnv();
		const root = mkdtempSync(join(tmpdir(), "hatch-factory-context-managed-instance-"));
		const configPath = join(root, "factory.config.json");
		writeJson(configPath, {
			schema: "hatch.factory.config.v1",
			factory_id: "brainstorm",
			runs_dir: ".hatch/brainstorm/runs",
			scenarios: { root: "scenarios/brainstorm" },
		});
		writeJson(join(root, ".hatch", "instance.json"), {
			instance_id: "fac_01JQ7M8JABCDEFG",
			kind_id: "brainstorm",
			target_repo: {
				provider: "github",
				repo_id: "R_kgDOExample",
				full_name: "example-org/brainstorm-lab",
			},
			control_plane_repo: "recallnet/astrochicken",
			destinations: {
				platform_incidents: {
					repo: "recallnet/astrochicken",
					labels: ["managed-factory-bug", "kind:brainstorm"],
				},
				goal_issues: {
					repo: "recallnet/astrochicken",
					labels: ["goal", "source:brainstorm"],
				},
			},
		});

		const context = resolveFactoryContext({ cwd: root, factoryConfigPath: configPath, requireTargetRepo: true });

		expect(context.factory_id).toBe("brainstorm");
		expect(context.target_repo).toBe("example-org/brainstorm-lab");
		expect(context.control_plane_repo).toBe("recallnet/astrochicken");
		expect(context.kind_id).toBe("brainstorm");
		expect(context.instance_id).toBe("fac_01JQ7M8JABCDEFG");
		expect(context.destinations_json).toBe("{\"goal_issues\":{\"labels\":[\"goal\",\"source:brainstorm\"],\"repo\":\"recallnet/astrochicken\"},\"platform_incidents\":{\"labels\":[\"managed-factory-bug\",\"kind:brainstorm\"],\"repo\":\"recallnet/astrochicken\"}}");
		expect(context.kind_path).toBe(join(root, "kind.json"));
		expect(context.instance_path).toBe(join(root, ".hatch", "instance.json"));
		expect(context.repo).toBe(root);
		expect(context.trust_domain).toBe("brainstorm.local");
		expect(context.trust_role).toBe("brainstorm.local.tool");
		expect(context.factory_mode).toBe("managed");
		expect(context.factory_mode_source.some((entry) => entry.source.includes(".hatch/instance.json"))).toBe(true);
	});

	it("resolves context from explicit flags and enforces precedence", () => {
		clearResolverEnv();
		const root = mkdtempSync(join(tmpdir(), "hatch-factory-context-flags-"));
		const factoryRoot = join(root, "factories", "mothership");
		const configPath = join(factoryRoot, "factory.config.json");
		writeJson(configPath, {
			schema: "hatch.factory.config.v1",
			factory_id: "mothership",
			target_repo: "recallnet/astrochicken",
			control_plane_repo: "recallnet/astrochicken",
			work_dir: "workspace/repo",
			trust: {
				domain: "mothership.local",
				roles: ["mothership.local.tool", "mothership.local.codergen"],
			},
			runs_dir: ".hatch/mothership/runs",
			scenarios: { root: "factories/mothership/scenarios/astrochicken" },
		});

		const context = resolveFactoryContext({
			cwd: root,
			factoryConfigPath: configPath,
			factoryId: "mothership-override",
			targetRepo: "override/repo",
			controlPlaneRepo: "override/control",
			kindId: "override-kind",
			instanceId: "override-instance",
			destinationsJson: '{"b":{"repo":"z/y"},"a":{"repo":"x/y"}}',
			runsDir: join(root, ".custom", "runs"),
			scenariosRoot: join(root, "custom", "scenarios"),
		});

		expect(context.factory_root).toBe(factoryRoot);
		expect(context.factory_config_path).toBe(configPath);
		expect(context.factory_id).toBe("mothership-override");
		expect(context.target_repo).toBe("override/repo");
		expect(context.control_plane_repo).toBe("override/control");
		expect(context.kind_id).toBe("override-kind");
		expect(context.instance_id).toBe("override-instance");
		expect(context.destinations_json).toBe('{"a":{"repo":"x/y"},"b":{"repo":"z/y"}}');
		expect(context.runs_dir).toBe(join(root, ".custom", "runs"));
		expect(context.scenarios_root).toBe(join(root, "custom", "scenarios"));
		expect(context.kind_path).toBe(join(factoryRoot, "kind.json"));
		expect(context.instance_path).toBe(join(factoryRoot, ".hatch", "instance.json"));
		expect(context.repo).toBe(join(factoryRoot, "workspace", "repo"));
		expect(context.trust_domain).toBe("mothership.local");
		expect(context.trust_role).toBe("mothership.local.tool");
		expect(context.factory_mode).toBe("managed");
		expect(context.factory_mode_source.some((entry) => entry.source.includes("flag(--kind-id)"))).toBe(true);
	});

	it("roots managed runs_dir under work_dir instead of the control-plane checkout", () => {
		clearResolverEnv();
		const root = mkdtempSync(join(tmpdir(), "hatch-factory-context-work-dir-runs-"));
		const factoryRoot = join(root, "factories", "example-trading");
		const configPath = join(factoryRoot, "factory.config.json");
		const workDir = join(root, "target-repo");
		writeJson(configPath, {
			schema: "hatch.factory.config.v1",
			factory_id: "example-trading",
			target_repo: "example-org/example-trading",
			control_plane_repo: "recallnet/astrochicken",
			work_dir: workDir,
			runs_dir: ".hatch/example-trading/runs",
			managed: true,
			scenarios: { root: "scenarios/example-trading" },
		});

		const context = resolveFactoryContext({
			cwd: root,
			factoryConfigPath: configPath,
			requireTargetRepo: true,
		});

		expect(context.repo).toBe(workDir);
		expect(context.runs_dir).toBe(join(workDir, ".hatch", "example-trading", "runs"));
	});

	it("preserves checkout workspace metadata for shipped Example Scanner config", () => {
		clearResolverEnv();
		const context = resolveFactoryContext({
			cwd: repoRoot,
			factoryConfigPath: join(repoRoot, "factories", "example-scanner", "factory.config.json"),
			requireTargetRepo: true,
		});

		expect(context.factory_id).toBe("example-scanner");
		expect(context.workspace_mode).toBe("checkout");
		expect(context.work_dir).toBe("/path/to/example-scanner");
		expect(context.canonical_checkout_path).toBe("${HATCH_CANONICAL_CHECKOUT_PATH}");
		expect(context.repo).toBe("/path/to/example-scanner");
		expect(context.runs_dir).toBe("/path/to/example-scanner/.hatch/example-scanner/runs");
	});

	it("prefers explicit options, then checked-in identity, then ambient env for target/kind/instance/destinations", () => {
		clearResolverEnv();
		const root = mkdtempSync(join(tmpdir(), "hatch-factory-context-precedence-"));
		const configPath = join(root, "factory.config.json");
		writeJson(configPath, {
			schema: "hatch.factory.config.v1",
			factory_id: "brainstorm",
			runs_dir: ".hatch/brainstorm/runs",
			scenarios: { root: "scenarios/brainstorm" },
		});
		writeJson(join(root, ".hatch", "instance.json"), {
			instance_id: "manifest-instance",
			kind_id: "manifest-kind",
			target_repo: {
				provider: "github",
				repo_id: "R_manifest",
				full_name: "manifest/home",
			},
			control_plane_repo: "manifest/control",
			destinations: {
				zz: { repo: "manifest/zz" },
			},
		});

		process.env.HATCH_TARGET_REPO = "env/target";
		process.env.HATCH_KIND_ID = "env-kind";
		process.env.HATCH_INSTANCE_ID = "env-instance";
		process.env.HATCH_DESTINATIONS_JSON = '{"env":{"repo":"env/repo"}}';

		const fromEnv = resolveFactoryContext({ cwd: root, factoryConfigPath: configPath, requireTargetRepo: true });
		expect(fromEnv.target_repo).toBe("manifest/home");
		expect(fromEnv.kind_id).toBe("manifest-kind");
		expect(fromEnv.instance_id).toBe("manifest-instance");
		expect(fromEnv.destinations_json).toBe('{"zz":{"repo":"manifest/zz"}}');

		const fromFlags = resolveFactoryContext({
			cwd: root,
			factoryConfigPath: configPath,
			targetRepo: "flag/target",
			kindId: "flag-kind",
			instanceId: "flag-instance",
			destinationsJson: '{"flag":{"repo":"flag/repo"}}',
			requireTargetRepo: true,
		});
		expect(fromFlags.target_repo).toBe("flag/target");
		expect(fromFlags.kind_id).toBe("flag-kind");
		expect(fromFlags.instance_id).toBe("flag-instance");
		expect(fromFlags.destinations_json).toBe('{"flag":{"repo":"flag/repo"}}');
	});

	it("prefers checked-in factory identity over inherited ambient env", () => {
		clearResolverEnv();
		const root = mkdtempSync(join(tmpdir(), "hatch-factory-context-hostile-env-"));
		const factoryRoot = join(root, "factories", "brainstorm");
		const configPath = join(factoryRoot, "factory.config.json");
		writeJson(configPath, {
			schema: "hatch.factory.config.v1",
			factory_id: "brainstorm",
			target_repo: "example-org/example-notes",
			control_plane_repo: "recallnet/astrochicken",
			kind_id: "brainstorm",
			instance_id: "brainstorm",
			destinations: {
				goal_issues: { repo: "recallnet/astrochicken" },
			},
			runs_dir: ".hatch/brainstorm/runs",
			scenarios: { root: "factories/brainstorm/scenarios/brainstorm" },
		});

		const context = resolveFactoryContext({
			cwd: root,
			factoryConfigPath: configPath,
			requireTargetRepo: true,
			processEnv: {
				HATCH_TARGET_REPO: "recallnet/astrochicken",
				HATCH_FACTORY_ROOT: "factories/mothership",
				HATCH_INSTANCE_ID: "mothership",
				HATCH_KIND_ID: "mothership",
				MOTHERSHIP_REPO: "recallnet/astrochicken",
			},
		});

		expect(context.factory_id).toBe("brainstorm");
		expect(context.target_repo).toBe("example-org/example-notes");
		expect(context.kind_id).toBe("brainstorm");
		expect(context.instance_id).toBe("brainstorm");
		expect(context.control_plane_repo).toBe("recallnet/astrochicken");
		expect(context.destinations_json).toBe('{"goal_issues":{"repo":"recallnet/astrochicken"}}');
		expect(context.factory_mode).toBe("managed");
		expect(context.factory_mode_source.some((entry) => entry.source.includes("factory.config.json") && entry.source.includes("#kind_id"))).toBe(true);
	});

	it("resolves target_repo from config", () => {
		clearResolverEnv();
		const root = mkdtempSync(join(tmpdir(), "hatch-factory-context-target-repo-"));
		const factoryRoot = join(root, "factories", "mothership");
		const configPath = join(factoryRoot, "factory.config.json");
		writeJson(configPath, {
			schema: "hatch.factory.config.v1",
			factory_id: "mothership",
			target_repo: "recallnet/astrochicken",
			control_plane_repo: "recallnet/astrochicken",
			runs_dir: ".hatch/mothership/runs",
			scenarios: { root: "factories/mothership/scenarios/astrochicken" },
		});

		const context = resolveFactoryContext({ cwd: root, factoryConfigPath: configPath, requireTargetRepo: true });
		expect(context.target_repo).toBe("recallnet/astrochicken");
		expect(context.control_plane_repo).toBe("recallnet/astrochicken");
		expect(context.factory_mode).toBe("standalone");
		expect(context.factory_mode_source.some((entry) => entry.source.includes("#default"))).toBe(true);
	});

	it("resolves target_repo for cross-repo factories", () => {
		clearResolverEnv();
		const root = mkdtempSync(join(tmpdir(), "hatch-factory-context-cross-repo-"));
		const factoryRoot = join(root, "factories", "example-trading");
		const configPath = join(factoryRoot, "factory.config.json");
		writeJson(configPath, {
			schema: "hatch.factory.config.v1",
			factory_id: "example-trading",
			target_repo: "example-org/example-trading",
			control_plane_repo: "recallnet/astrochicken",
			runs_dir: ".hatch/example-trading/runs",
			scenarios: { root: "factories/example-trading/scenarios/example-trading" },
		});

		const context = resolveFactoryContext({ cwd: root, factoryConfigPath: configPath, requireTargetRepo: true });
		expect(context.target_repo).toBe("example-org/example-trading");
		expect(context.control_plane_repo).toBe("recallnet/astrochicken");
	});

	it("fails closed when instance target_repo conflicts with config target_repo", () => {
		clearResolverEnv();
		const root = mkdtempSync(join(tmpdir(), "hatch-factory-context-identity-mismatch-"));
		const configPath = join(root, "factory.config.json");
		writeJson(configPath, {
			schema: "hatch.factory.config.v1",
			factory_id: "brainstorm",
			target_repo: "config/home",
			runs_dir: ".hatch/brainstorm/runs",
			scenarios: { root: "scenarios/brainstorm" },
		});
		writeJson(join(root, ".hatch", "instance.json"), {
			instance_id: "fac_01",
			kind_id: "brainstorm",
			target_repo: {
				provider: "github",
				repo_id: "R_kgDOExample",
				full_name: "manifest/home",
			},
			control_plane_repo: "recallnet/astrochicken",
			destinations: {
				goal_issues: { repo: "recallnet/astrochicken" },
			},
		});

		expect(() => resolveFactoryContext({ cwd: root, factoryConfigPath: configPath })).toThrow(/identity mismatch/);
	});

	it("fails closed when scenarios.root is not declared and no override is provided", () => {
		clearResolverEnv();
		const root = mkdtempSync(join(tmpdir(), "hatch-factory-context-missing-scenarios-"));
		const factoryRoot = join(root, "factories", "mothership");
		const configPath = join(factoryRoot, "factory.config.json");
		writeJson(configPath, {
			schema: "hatch.factory.config.v1",
			factory_id: "mothership",
			target_repo: "recallnet/astrochicken",
			control_plane_repo: "recallnet/astrochicken",
			runs_dir: ".hatch/mothership/runs",
		});

		expect(() => resolveFactoryContext({ cwd: root, factoryConfigPath: configPath })).toThrow(
			/\[factory-context\] unable to resolve scenarios\.root/,
		);
	});

	it("fails closed on isolation mismatch", () => {
		clearResolverEnv();
		const root = mkdtempSync(join(tmpdir(), "hatch-factory-context-isolation-"));
		const factoryRoot = join(root, "factories", "mothership");
		const configPath = join(factoryRoot, "factory.config.json");
		writeJson(configPath, {
			schema: "hatch.factory.config.v1",
			factory_id: "mothership",
			target_repo: "recallnet/astrochicken",
			control_plane_repo: "recallnet/astrochicken",
			runs_dir: ".hatch/mothership/runs",
			scenarios: { root: "factories/mothership/scenarios/astrochicken" },
			isolation: {
				auth: {
					github: {
						tokenEnvVar: "FACTORY_GITHUB_TOKEN",
						repo: "example-org/other-repo",
						factoryId: "mothership",
					},
				},
			},
		});
		process.env.FACTORY_GITHUB_TOKEN = "ghp_test";

		expect(() => resolveFactoryContext({ cwd: root, factoryConfigPath: configPath })).toThrow(
			/expected isolation\.auth\.github\.repo=example-org\/other-repo but resolved factory target=recallnet\/astrochicken/,
		);
	});

	it("resolves factory config from factoryId when factories/{id} directory exists and no explicit root/config given", () => {
		clearResolverEnv();
		const root = mkdtempSync(join(tmpdir(), "hatch-factory-context-id-resolve-"));
		// Set up two factories: mothership (default) and example-trading
		const mothershipRoot = join(root, "factories", "mothership");
		const exampleTradingRoot = join(root, "factories", "example-trading");
		writeJson(join(mothershipRoot, "factory.config.json"), {
			schema: "hatch.factory.config.v1",
			factory_id: "mothership",
			target_repo: "recallnet/astrochicken",
			control_plane_repo: "recallnet/astrochicken",
			runs_dir: ".hatch/mothership/runs",
			scenarios: { root: "factories/mothership/scenarios/astrochicken" },
		});
		writeJson(join(exampleTradingRoot, "factory.config.json"), {
			schema: "hatch.factory.config.v1",
			factory_id: "example-trading",
			target_repo: "example-org/example-trading",
			control_plane_repo: "recallnet/astrochicken",
			runs_dir: ".hatch/example-trading/runs",
			scenarios: { root: "factories/example-trading/scenarios/example-trading" },
		});

		// With factoryId="example-trading", should load example-trading's config — not mothership's
		const exampleTradingCtx = resolveFactoryContext({ cwd: root, factoryId: "example-trading" });
		expect(exampleTradingCtx.factory_id).toBe("example-trading");
		expect(exampleTradingCtx.target_repo).toBe("example-org/example-trading");
		expect(exampleTradingCtx.control_plane_repo).toBe("recallnet/astrochicken");
		expect(exampleTradingCtx.factory_root).toBe(exampleTradingRoot);
		expect(exampleTradingCtx.factory_mode).toBe("managed");
	});

	it("fails closed when high-precedence mode signals conflict", () => {
		clearResolverEnv();
		const root = mkdtempSync(join(tmpdir(), "hatch-factory-context-mode-conflict-"));
		const configPath = join(root, "factory.config.json");
		writeJson(configPath, {
			schema: "hatch.factory.config.v1",
			factory_id: "brainstorm",
			managed: false,
			kind_id: "brainstorm",
			target_repo: "example-org/brainstorm-lab",
			control_plane_repo: "recallnet/astrochicken",
			runs_dir: ".hatch/brainstorm/runs",
			scenarios: { root: "scenarios/brainstorm" },
		});

		expect(() => resolveFactoryContext({ cwd: root, factoryConfigPath: configPath })).toThrow(
			new RegExp(`\\[factory-context:${FACTORY_CONTEXT_MODE_CONFLICT_ERROR_CODE}\\]`),
		);
	});
});
