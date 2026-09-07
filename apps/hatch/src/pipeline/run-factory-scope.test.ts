import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	configureRunStorageScope,
	inferFactoryIdFromPipelineConfig,
	inferFactoryTelemetryIdentityFromPipelineConfig,
	runsDir,
} from "./run.js";

let originalFactoryId: string | undefined;
let originalRunsDir: string | undefined;
let originalHostBaseDir: string | undefined;

beforeEach(() => {
	originalFactoryId = process.env["HATCH_FACTORY_ID"];
	originalRunsDir = process.env["HATCH_RUNS_DIR"];
	originalHostBaseDir = process.env["HATCH_HOST_BASE_DIR"];
	delete process.env["HATCH_FACTORY_ID"];
	delete process.env["HATCH_RUNS_DIR"];
	delete process.env["HATCH_HOST_BASE_DIR"];
});

afterEach(() => {
	if (originalFactoryId === undefined) delete process.env["HATCH_FACTORY_ID"];
	else process.env["HATCH_FACTORY_ID"] = originalFactoryId;

	if (originalRunsDir === undefined) delete process.env["HATCH_RUNS_DIR"];
	else process.env["HATCH_RUNS_DIR"] = originalRunsDir;

	if (originalHostBaseDir === undefined) delete process.env["HATCH_HOST_BASE_DIR"];
	else process.env["HATCH_HOST_BASE_DIR"] = originalHostBaseDir;

	configureRunStorageScope({ runsDir: ".hatch/runs" });
});

function validFactoryConfig(factoryId: string): Record<string, unknown> {
	const dispatchGraph = `factories/${factoryId}/graphs/factory_supervisor_tick.dot`;
	const trustDomain = `${factoryId}.local`;
	return {
		schema: "hatch.factory.config.v1",
		factory_id: factoryId,
		target_repo: "example-org/test-repo",
		control_plane_repo: "recallnet/astrochicken",
		dispatch: { graph: dispatchGraph },
		skills: { supervisor: `factories/${factoryId}/skills/supervisor/current.md` },
		scenarios: { root: `factories/${factoryId}/scenarios/${factoryId}` },
		pipeline: { supervisor_tick: dispatchGraph },
		runs_dir: `.hatch/${factoryId}/runs`,
		trust: {
			domain: trustDomain,
			roles: [`${trustDomain}.tool`, `${trustDomain}.codergen`],
		},
	};
}

describe("run storage scope", () => {
	it("scopes run directory by explicit factory id", () => {
		const scoped = configureRunStorageScope({ factoryId: "mothership" });
		expect(scoped).toBe(resolve(process.cwd(), ".hatch", "mothership", "runs"));
		expect(runsDir()).toBe(scoped);
	});

	it("prefers host-scoped runtime storage when HATCH_HOST_BASE_DIR is configured", () => {
		const hostBaseDir = mkdtempSync(join(tmpdir(), "hatch-host-runtime-"));
		process.env["HATCH_HOST_BASE_DIR"] = hostBaseDir;
		const scoped = configureRunStorageScope({ factoryId: "mothership" });
		expect(scoped).toBe(resolve(hostBaseDir, "mothership", "runs"));
	});

	it("infers factory id from nearest valid factory.config.json", () => {
		const root = mkdtempSync(join(tmpdir(), "hatch-run-scope-"));
		const factoryRoot = join(root, "factories", "test-factory");
		mkdirSync(join(factoryRoot, "graphs"), { recursive: true });
		writeFileSync(
			join(factoryRoot, "factory.config.json"),
			JSON.stringify(validFactoryConfig("test-factory"), null, 2),
		);
		const pipelinePath = join(factoryRoot, "graphs", "factory_supervisor_tick.dot");
		writeFileSync(pipelinePath, "digraph test {}\n");

		const identity = inferFactoryTelemetryIdentityFromPipelineConfig(pipelinePath);
		expect(identity.factory_id).toBe("test-factory");
		expect(identity.repo).toBe("example-org/test-repo");
		expect(identity.validation.status).toBe("valid");

		const scoped = configureRunStorageScope({ pipelineFile: pipelinePath });
		expect(scoped).toBe(resolve(process.cwd(), ".hatch", "test-factory", "runs"));
	});

	it("returns validation metadata when nearest factory config is invalid", () => {
		const root = mkdtempSync(join(tmpdir(), "hatch-run-scope-invalid-"));
		const factoryRoot = join(root, "factories", "broken-factory");
		mkdirSync(join(factoryRoot, "graphs"), { recursive: true });
		writeFileSync(
			join(factoryRoot, "factory.config.json"),
			JSON.stringify({ factory_id: "BROKEN" }, null, 2),
		);
		const pipelinePath = join(factoryRoot, "graphs", "factory_supervisor_tick.dot");
		writeFileSync(pipelinePath, "digraph test {}\n");

		const identity = inferFactoryTelemetryIdentityFromPipelineConfig(pipelinePath);
		expect(identity.factory_id).toBe("");
		expect(identity.validation.status).toBe("invalid");
		expect(identity.validation.configPath).toBe(join(factoryRoot, "factory.config.json"));
		expect(identity.validation.message).toContain("schema");

		expect(inferFactoryIdFromPipelineConfig(pipelinePath)).toBe("");
	});
});
