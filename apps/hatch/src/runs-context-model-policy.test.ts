import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configureRunStorageScope, createRunState, saveRunState } from "./pipeline/run.js";
import { cmdRuns } from "./runs.js";

async function captureStdout(run: () => Promise<void>): Promise<string> {
	const chunks: string[] = [];
	const spy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
		chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : String(chunk));
		return true;
	}) as typeof process.stdout.write);

	try {
		await run();
	} finally {
		spy.mockRestore();
	}

	return chunks.join("");
}

describe("hatch runs context model policy metadata", () => {
	let root: string;
	let runsDir: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "hatch-runs-context-policy-"));
		runsDir = join(root, ".hatch", "runs");
		mkdirSync(runsDir, { recursive: true });
		configureRunStorageScope({ runsDir });
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("returns resolved model policy metadata in --json context output", async () => {
		const run = createRunState("run-context-policy", "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs");
		run.context = {
			model_policy_source: "factories/mothership/factory.config.json",
			model_policy_version: "v1",
			model_policy_policy_pack_dir: "factories/mothership/policy-pack/v1",
			model_policy_default_provider: "openrouter",
			model_policy_default_model: "openai/gpt-5.3-codex",
			model_policy_allowed_models: "openai/gpt-5.3-codex,anthropic/claude-sonnet-4-6",
			model_policy_selected_via: "env_override",
		};
		saveRunState(run);

		const output = await captureStdout(async () => {
			await cmdRuns(["context", run.runId, "--json"]);
		});
		const payload = JSON.parse(output) as {
			runId: string;
			modelPolicy: {
				source: string;
				version: string;
				policyPackDir: string;
				defaultProvider: string;
				defaultModel: string;
				selectedVia: string;
				allowedModels: string[];
			};
		};

		expect(payload.runId).toBe(run.runId);
		expect(payload.modelPolicy).toEqual({
			source: "factories/mothership/factory.config.json",
			version: "v1",
			policyPackDir: "factories/mothership/policy-pack/v1",
			defaultProvider: "openrouter",
			defaultModel: "openai/gpt-5.3-codex",
			selectedVia: "env_override",
			allowedModels: ["openai/gpt-5.3-codex", "anthropic/claude-sonnet-4-6"],
		});
	});
});
