import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { Context, StageStatus, type Outcome } from "./context.js";
import { Engine, HandlerRegistry, type Handler } from "./engine.js";
import { ToolHandler } from "./handler/tool.js";
import { parse } from "./parse.js";

import type { Node } from "./graph.js";


const _testDir = dirname(fileURLToPath(import.meta.url));
const _repoRoot = resolve(_testDir, "../../../..");
const _opsCliPath = join(_repoRoot, "packages/factory-ops/src/cli.mjs");

class StaticOutputHandler implements Handler {
	constructor(private readonly output: string) {}

	async execute(_signal: AbortSignal, _node: Node): Promise<Outcome> {
		return { status: StageStatus.Completed, output: this.output };
	}
}

function sh(args: string[], cwd: string) {
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
	);
	execFileSync(args[0]!, args.slice(1), { cwd, stdio: "pipe", env });
}

function makeShim(binDir: string, name: string, body: string) {
	const path = join(binDir, name);
	writeFileSync(path, body, "utf8");
	chmodSync(path, 0o755);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("builder notes handoff graph path", () => {
	const cleanupDirs: string[] = [];

	afterEach(() => {
		for (const dir of cleanupDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

		it(
		"persists builder_notes into review evidence and reviewer context through the real graph tool path",
		async () => {
		const root = mkdtempSync(join(tmpdir(), "builder-notes-graph-"));
		const repoDir = join(root, "repo");
		const binDir = join(root, "bin");
		const skillDir = join(root, "packages", "factory-skills", "skills", "code_review");
		cleanupDirs.push(root);

		mkdirSync(repoDir, { recursive: true });
		mkdirSync(binDir, { recursive: true });
		mkdirSync(skillDir, { recursive: true });

		writeFileSync(join(skillDir, "SKILL.md"), "---\nqa_required: true\nroute_override: \"\"\n---\n# Skill\n");
		writeFileSync(join(skillDir, "REPO.md"), "---\nqa_required: false\n---\n# Repo\n");

		sh(["git", "init", "-b", "main"], repoDir);
		sh(["git", "config", "user.email", "hatch@example.com"], repoDir);
		sh(["git", "config", "user.name", "DevRel"], repoDir);
		writeFileSync(join(repoDir, "README.md"), "base\n", "utf8");
		sh(["git", "add", "README.md"], repoDir);
		sh(["git", "commit", "-m", "base"], repoDir);
		try {
			sh(["git", "remote", "add", "origin", "git@github.com:recallnet/astrochicken.git"], repoDir);
		} catch {
			sh(["git", "remote", "set-url", "origin", "git@github.com:recallnet/astrochicken.git"], repoDir);
		}
		sh(["git", "checkout", "-B", "feature/builder-notes"], repoDir);
		writeFileSync(join(repoDir, "README.md"), "base\nupdated\n", "utf8");
		sh(["git", "add", "README.md"], repoDir);
		sh(["git", "commit", "-m", "feat: align evidence (#43)"], repoDir);

		makeShim(
			binDir,
			"hatch-ops",
			`#!/usr/bin/env bash
node ${_opsCliPath} "$@"
`,
		);
		makeShim(
			binDir,
			"gh",
			`#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "issue" && args[1] === "view") {
  process.stdout.write(JSON.stringify({ title: "Builder note issue", body: "Most of this issue was already complete." }) + "\\n");
  process.exit(0);
}
process.exit(1);
`,
		);

		const builderOutputToken = "${builder_output}";
		const builderOutputB64Token = "${builder_output_b64}";
		const reviewEvidencePathToken = "${review_evidence_path}";

		const graph = parse(`
			digraph builder_notes_handoff {
				graph [workdir="${root}"]
				start [shape=Mdiamond]
				build [type="agent.worktree" output_key="builder_output"]
				encode_builder_output [type="tool" output_key="builder_output_b64" prompt="hatch-ops common run --op encode-base64 --raw '${builderOutputToken}'"]
				write_review_evidence [type="tool" output_format="json" outputs="review_evidence_path,builder_notes" prompt="hatch-ops goal-issue write-review-evidence --worktree-dir '${repoDir}' --repo '${repoDir}' --issue '43' --branch 'feature/builder-notes' --review-qa-command 'true' --integration-command 'true' --builder-notes-b64 '${builderOutputB64Token}'"]
				build_review_context [type="tool" output_format="json" outputs="review_context_path,review_context_sha256,review_context_valid,review_context_error" prompt="hatch-ops goal-issue build-review-context --worktree-dir '${repoDir}' --issue '43' --branch 'feature/builder-notes' --review-evidence-path '${reviewEvidencePathToken}'"]
				done [shape=Msquare]
				start -> build -> encode_builder_output -> write_review_evidence -> build_review_context -> done
			}
		`);

		const registry = new HandlerRegistry();
		registry.register("start", new StaticOutputHandler(""));
		registry.register("exit", new StaticOutputHandler(""));
		registry.register(
			"agent.worktree",
			new StaticOutputHandler(
				[
					"Implemented the final scoped adjustment.",
					"",
					"BUILDER_NOTES: Most of the issue was already satisfied before this pass; this run only verified the branch state and tightened the review artifact.",
				].join("\n"),
			),
		);
		registry.register(
			"tool",
			new ToolHandler(root, graph, { PATH: `${binDir}:${process.env.PATH || ""}` }),
		);

		const engine = new Engine(graph, registry, { context: new Context() });
		await engine.run();

		const evidencePath = engine.getContext().get("review_evidence_path");
		const reviewContextPath = engine.getContext().get("review_context_path");
		expect(evidencePath).toBeTruthy();
		expect(reviewContextPath).toBeTruthy();

		const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
		const reviewerContext = JSON.parse(readFileSync(reviewContextPath, "utf8"));
		expect(evidence.builder_notes).toBe("Most of the issue was already satisfied before this pass; this run only verified the branch state and tightened the review artifact.");
			expect(reviewerContext.builder_notes).toBe(evidence.builder_notes);
			expect(engine.getContext().get("builder_notes")).toBe(evidence.builder_notes);
			expect(engine.getContext().get("review_context_valid")).toBe("true");
		},
		30_000,
	);
});
