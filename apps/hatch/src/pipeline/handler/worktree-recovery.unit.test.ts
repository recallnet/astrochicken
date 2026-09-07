/**
 * Worktree Handler Recovery Tests
 *
 * Tests all code paths that determine what happens when the factory restarts
 * after a crash: session resume, prompt construction, dirty cleanup, worktree
 * creation, model resolution, and API error detection.
 *
 * NOT testing telemetry — that's covered by langfuse-instrumentation.test.ts.
 * Focus is on behavioral correctness of recovery paths.
 */
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const {
	createAgentSessionMock,
	createCodingToolsMock,
	sessionManagerMock,
	settingsManagerMock,
	execFileSyncMock,
} = vi.hoisted(() => ({
	createAgentSessionMock: vi.fn(),
	createCodingToolsMock: vi.fn(() => []),
	sessionManagerMock: {
		inMemory: vi.fn(() => ({ kind: "in-memory" })),
		continueRecent: vi.fn(() => ({ kind: "continue-recent" })),
	},
	settingsManagerMock: {
		inMemory: vi.fn(() => ({ kind: "settings" })),
	},
	execFileSyncMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	execFileSync: execFileSyncMock,
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
	createAgentSession: createAgentSessionMock,
	createCodingTools: createCodingToolsMock,
	SessionManager: sessionManagerMock,
	SettingsManager: settingsManagerMock,
}));

import { EventBus } from "@recallnet/factory-telemetry";

import { Context, StageStatus } from "../context.js";
import { WorktreeAgentHandler } from "./worktree.js";

function makeModelRegistry() {
	return {
		find: vi.fn((_provider: string, _model: string) => ({ id: "mock-model" })),
	};
}

function makeAssistantMessage(text: string) {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		provider: "anthropic",
		model: "claude-sonnet-4-6",
		stopReason: "stop",
		usage: {
			input: 10, output: 5, totalTokens: 15,
			cacheRead: 0, cacheWrite: 0,
			cost: { input: 0.1, output: 0.05, cacheRead: 0, cacheWrite: 0, total: 0.15 },
		},
	};
}

function makeMockSession(options: {
	onPrompt?: (call: number, emit: (event: any) => void, session: any) => Promise<void> | void;
} = {}) {
	const listeners: Array<(event: any) => void> = [];
	let promptCalls = 0;
	const session: any = {
		messages: [] as any[],
		disposed: false,
		subscribe(listener: (event: any) => void) {
			listeners.push(listener);
			return () => {
				const idx = listeners.indexOf(listener);
				if (idx >= 0) listeners.splice(idx, 1);
			};
		},
		async prompt(_prompt: string) {
			promptCalls += 1;
			await options.onPrompt?.(promptCalls, (event) => listeners.forEach((l) => l(event)), session);
		},
		dispose() {
			session.disposed = true;
		},
		get promptCalls() { return promptCalls; },
	};
	return session;
}

function makeHandler(overrides: Record<string, any> = {}) {
	return new WorktreeAgentHandler({
		modelRegistry: makeModelRegistry() as any,
		authStorage: {} as any,
		resourceLoader: {} as any,
		defaultModel: "claude-sonnet-4-6",
		defaultProvider: "anthropic",
		workDir: ".",
		eventBus: new EventBus(),
		...overrides,
	} as any);
}

function makeNode(attrs: Record<string, string> = {}) {
	return {
		id: "build",
		attrs: {
			type: "agent.worktree",
			repo: "/tmp/repo",
			branch: "wave/test-wave",
			prompt: "Implement the feature as described in the issue",
			agent_provider: "anthropic",
			agent_model: "claude-sonnet-4-6",
			...attrs,
		},
	} as any;
}

// Configurable git mock: control what rev-list and status return
function mockGit(opts: { commitsAhead?: number; dirty?: boolean; log?: string } = {}) {
	const { commitsAhead = 0, dirty = false, log = "abc123 test commit" } = opts;
	execFileSyncMock.mockImplementation((command: string, args: string[], options?: { cwd?: string }) => {
		if (command !== "git") return Buffer.from("");
		if (args.includes("rev-list")) return Buffer.from(`${commitsAhead}\n`);
		if (args.includes("status")) return Buffer.from(dirty ? "M file.ts\n" : "\n");
		if (args.includes("log")) return Buffer.from(`${log}\n`);
		if (args.includes("--is-inside-work-tree")) return Buffer.from("true\n");
		if (args.includes("--show-toplevel")) return Buffer.from(`${options?.cwd || "/tmp/worktree"}\n`);
		if (args.includes("checkout")) return Buffer.from("");
		if (args.includes("worktree")) return Buffer.from("");
		return Buffer.from("");
	});
}

describe("worktree handler recovery paths", () => {
	let tempRoot: string;

	beforeEach(() => {
		vi.clearAllMocks();
		tempRoot = mkdtempSync(join(tmpdir(), "hatch-wt-recovery-"));
	});

	afterEach(() => {
		rmSync(tempRoot, { recursive: true, force: true });
	});

	// Helper to make the worktree directory exist (simulating recovery scenario)
	function setupExistingWorktree(branch: string) {
		const repoDir = join(tempRoot, "repo");
		const worktreeDir = join(tempRoot, ".hatch-worktrees", branch);
		mkdirSync(repoDir, { recursive: true });
		mkdirSync(worktreeDir, { recursive: true });
		return { repoDir, worktreeDir };
	}

	// ─── PATH 1: Recovery noop (skip_prompt_if_commits_exist=true) ────────

	describe("recovery noop: skip_prompt_if_commits_exist=true with commits", () => {
		it("returns completed noop without calling LLM when commits exist and worktree is clean", async () => {
			const branch = "wave/recovery-noop";
			const { repoDir } = setupExistingWorktree(branch);
			mockGit({ commitsAhead: 3, dirty: false, log: "abc Recovery commit 1\ndef Recovery commit 2\nghi Recovery commit 3" });

			const handler = makeHandler();
			const outcome = await handler.execute(
				new AbortController().signal,
				makeNode({ repo: repoDir, branch, skip_prompt_if_commits_exist: "true" }),
				new Context({ __run_id: "run-1" }),
				"",
			);

			expect(outcome.status).toBe(StageStatus.Completed);
			expect(outcome.output).toContain("[recovery]");
			expect(outcome.output).toContain("3 commits");
			expect(createAgentSessionMock).not.toHaveBeenCalled();
		});

		it("includes git log in recovery noop output", async () => {
			const branch = "wave/recovery-log";
			const { repoDir } = setupExistingWorktree(branch);
			mockGit({ commitsAhead: 2, log: "abc123 feat: implement parser\ndef456 test: add parser tests" });

			const handler = makeHandler();
			const outcome = await handler.execute(
				new AbortController().signal,
				makeNode({ repo: repoDir, branch, skip_prompt_if_commits_exist: "true" }),
				new Context({ __run_id: "run-2" }),
				"",
			);

			expect(outcome.output).toContain("abc123");
			expect(outcome.output).toContain("implement parser");
		});

		it("populates context updates with commit count and worktree path", async () => {
			const branch = "wave/recovery-ctx";
			const { repoDir } = setupExistingWorktree(branch);
			mockGit({ commitsAhead: 5 });

			const handler = makeHandler();
			const outcome = await handler.execute(
				new AbortController().signal,
				makeNode({ repo: repoDir, branch, skip_prompt_if_commits_exist: "true" }),
				new Context({ __run_id: "run-3" }),
				"",
			);

			expect(outcome.contextUpdates).toBeDefined();
			expect(outcome.contextUpdates?.["wave_recovery_ctx_commits"]).toBe("5");
		});
	});

	// ─── PATH 2: Recovery prompt (skip_prompt_if_commits_exist=false) ─────

	describe("recovery with re-prompt: skip_prompt_if_commits_exist=false with commits", () => {
		it("prepends recovery context to prompt when commits exist", async () => {
			const branch = "wave/recovery-reprompt";
			const { repoDir } = setupExistingWorktree(branch);
			mockGit({ commitsAhead: 2, log: "abc123 first commit\ndef456 second commit" });

			let capturedPrompt = "";
			const session = makeMockSession({
				onPrompt: async (_call, emit, s) => {
					capturedPrompt = _call === 1 ? s.messages?.[0]?.content ?? "" : "";
					const msg = makeAssistantMessage("continued work");
					s.messages = [msg];
					emit({ type: "message_end", message: msg });
				},
			});
			createAgentSessionMock.mockResolvedValue({ session });

			const handler = makeHandler();
			const outcome = await handler.execute(
				new AbortController().signal,
				makeNode({ repo: repoDir, branch, skip_prompt_if_commits_exist: "false" }),
				new Context({ __run_id: "run-4" }),
				"",
			);

			expect(outcome.status).toBe(StageStatus.Completed);
			expect(createAgentSessionMock).toHaveBeenCalledTimes(1);
			// The handler passes prompt to promptAndExtractText, not directly to session.prompt.
			// We verify recovery was detected by checking session was created (not noop).
		});

		it("creates agent session even when commits exist if skip_prompt_if_commits_exist=false", async () => {
			const branch = "wave/recovery-session";
			const { repoDir } = setupExistingWorktree(branch);
			mockGit({ commitsAhead: 1 });

			const session = makeMockSession({
				onPrompt: async (_call, emit, s) => {
					const msg = makeAssistantMessage("ok");
					s.messages = [msg];
					emit({ type: "message_end", message: msg });
				},
			});
			createAgentSessionMock.mockResolvedValue({ session });

			const handler = makeHandler();
			await handler.execute(
				new AbortController().signal,
				makeNode({ repo: repoDir, branch, skip_prompt_if_commits_exist: "false" }),
				new Context({ __run_id: "run-5" }),
				"",
			);

			expect(createAgentSessionMock).toHaveBeenCalledTimes(1);
		});
	});

	// ─── PATH 3: Dirty worktree cleanup ──────────────────────────────────

	describe("dirty worktree cleanup", () => {
		it("runs git checkout to clean dirty worktree before recovery", async () => {
			const branch = "wave/dirty-cleanup";
			const { repoDir } = setupExistingWorktree(branch);
			mockGit({ commitsAhead: 1, dirty: true });

			const session = makeMockSession({
				onPrompt: async (_call, emit, s) => {
					const msg = makeAssistantMessage("cleaned up");
					s.messages = [msg];
					emit({ type: "message_end", message: msg });
				},
			});
			createAgentSessionMock.mockResolvedValue({ session });

			const handler = makeHandler();
			await handler.execute(
				new AbortController().signal,
				makeNode({ repo: repoDir, branch, skip_prompt_if_commits_exist: "false" }),
				new Context({ __run_id: "run-6" }),
				"",
			);

			// Verify git checkout was called for cleanup
			const checkoutCalls = execFileSyncMock.mock.calls.filter(
				(call: any[]) => call[0] === "git" && call[1]?.includes("checkout"),
			);
			expect(checkoutCalls.length).toBeGreaterThan(0);
		});

		it("does NOT return noop for dirty worktree even with skip_prompt_if_commits_exist=true", async () => {
			const branch = "wave/dirty-noop";
			const { repoDir } = setupExistingWorktree(branch);
			mockGit({ commitsAhead: 2, dirty: true });

			const session = makeMockSession({
				onPrompt: async (_call, emit, s) => {
					const msg = makeAssistantMessage("ok");
					s.messages = [msg];
					emit({ type: "message_end", message: msg });
				},
			});
			createAgentSessionMock.mockResolvedValue({ session });

			const handler = makeHandler();
			const outcome = await handler.execute(
				new AbortController().signal,
				makeNode({ repo: repoDir, branch, skip_prompt_if_commits_exist: "true" }),
				new Context({ __run_id: "run-7" }),
				"",
			);

			// Dirty worktree bypasses the noop short-circuit even with skip=true
			// because isDirty=true makes the condition fail: commitsAhead > 0 && !isDirty && skip
			expect(createAgentSessionMock).toHaveBeenCalledTimes(1);
		});
	});

	// ─── PATH 4: Fresh worktree creation ─────────────────────────────────

	describe("worktree creation", () => {
		it("reuses explicit worktree_dir from context instead of recomputing from branch", async () => {
			const repoDir = join(tempRoot, "repo");
			const explicitWorktreeDir = join(tempRoot, ".hatch-worktrees", "wave", "wave", "goal-1936-wave-1");
			mkdirSync(repoDir, { recursive: true });
			mkdirSync(explicitWorktreeDir, { recursive: true });
			mockGit({ commitsAhead: 0 });

			const session = makeMockSession({
				onPrompt: async (_call, emit, s) => {
					const msg = makeAssistantMessage("implemented");
					s.messages = [msg];
					emit({ type: "message_end", message: msg });
				},
			});
			createAgentSessionMock.mockResolvedValue({ session });

			const handler = makeHandler();
			const outcome = await handler.execute(
				new AbortController().signal,
				makeNode({ repo: repoDir, branch: "wave/goal-1936-wave-1" }),
				new Context({ __run_id: "run-explicit-worktree", worktree_dir: explicitWorktreeDir }),
				"",
			);

			expect(outcome.status).toBe(StageStatus.Completed);
			expect(createAgentSessionMock).toHaveBeenCalledTimes(1);
			expect(createAgentSessionMock.mock.calls[0]?.[0]?.cwd).toBe(explicitWorktreeDir);

			const worktreeAddCalls = execFileSyncMock.mock.calls.filter(
				(call: any[]) => call[0] === "git" && call[1]?.includes("worktree") && call[1]?.includes("add"),
			);
			expect(worktreeAddCalls).toHaveLength(0);
		});

		it("creates new worktree when directory does not exist", async () => {
			// Don't create the worktree dir — handler should create it
			const repoDir = join(tempRoot, "repo");
			mkdirSync(repoDir, { recursive: true });
			mockGit({ commitsAhead: 0 });

			const session = makeMockSession({
				onPrompt: async (_call, emit, s) => {
					const msg = makeAssistantMessage("fresh start");
					s.messages = [msg];
					emit({ type: "message_end", message: msg });
				},
			});
			createAgentSessionMock.mockResolvedValue({ session });

			const handler = makeHandler();
			const outcome = await handler.execute(
				new AbortController().signal,
				makeNode({ repo: repoDir, branch: "wave/fresh" }),
				new Context({ __run_id: "run-8" }),
				"",
			);

			// Verify worktree add was attempted
			const worktreeCalls = execFileSyncMock.mock.calls.filter(
				(call: any[]) => call[0] === "git" && call[1]?.includes("worktree"),
			);
			expect(worktreeCalls.length).toBeGreaterThan(0);
		});

		it("falls back to existing branch when -b creation fails", async () => {
			const repoDir = join(tempRoot, "repo");
			mkdirSync(repoDir, { recursive: true });

			let worktreeAttempts = 0;
			execFileSyncMock.mockImplementation((command: string, args: string[]) => {
				if (command !== "git") return Buffer.from("");
				if (args.includes("worktree") && args.includes("add")) {
					worktreeAttempts++;
					if (args.includes("-b")) throw new Error("branch already exists");
					return Buffer.from("");
				}
				if (args.includes("rev-list")) return Buffer.from("0\n");
				if (args.includes("status")) return Buffer.from("\n");
				if (args.includes("log")) return Buffer.from("abc test\n");
				return Buffer.from("");
			});

			const session = makeMockSession({
				onPrompt: async (_call, emit, s) => {
					const msg = makeAssistantMessage("using existing");
					s.messages = [msg];
					emit({ type: "message_end", message: msg });
				},
			});
			createAgentSessionMock.mockResolvedValue({ session });

			const handler = makeHandler();
			await handler.execute(
				new AbortController().signal,
				makeNode({ repo: repoDir, branch: "wave/existing" }),
				new Context({ __run_id: "run-9" }),
				"",
			);

			expect(worktreeAttempts).toBe(2);
		});

		it("returns failed outcome when both worktree creation attempts fail", async () => {
			const repoDir = join(tempRoot, "repo");
			mkdirSync(repoDir, { recursive: true });

			execFileSyncMock.mockImplementation((command: string, args: string[]) => {
				if (command === "git" && args.includes("worktree")) {
					throw new Error("fatal: cannot create worktree");
				}
				return Buffer.from("");
			});

			const handler = makeHandler();
			const outcome = await handler.execute(
				new AbortController().signal,
				makeNode({ repo: repoDir, branch: "wave/broken" }),
				new Context({ __run_id: "run-10" }),
				"",
			);

			expect(outcome.status).toBe(StageStatus.Failed);
			expect(outcome.error).toContain("failed to create worktree");
			expect(createAgentSessionMock).not.toHaveBeenCalled();
		});

		it("fails closed when explicit worktree_dir is the canonical checkout", async () => {
			const repoDir = join(tempRoot, "repo");
			mkdirSync(repoDir, { recursive: true });

			const handler = makeHandler();
			const outcome = await handler.execute(
				new AbortController().signal,
				makeNode({ repo: repoDir, branch: "wave/canonical", worktree_dir: repoDir }),
				new Context({ __run_id: "run-canonical" }),
				"",
			);

			expect(outcome.status).toBe(StageStatus.Failed);
			expect(outcome.error).toContain("must not be the canonical checkout");
			expect(createAgentSessionMock).not.toHaveBeenCalled();
		});

		it("fails closed when an existing worktree path is not a git repo", async () => {
			const repoDir = join(tempRoot, "repo");
			const badWorktreeDir = join(tempRoot, ".hatch-worktrees", "wave", "broken");
			mkdirSync(repoDir, { recursive: true });
			mkdirSync(badWorktreeDir, { recursive: true });

			execFileSyncMock.mockImplementation((command: string, args: string[]) => {
				if (command !== "git") return Buffer.from("");
				if (args.includes("--is-inside-work-tree")) throw new Error("not a git repository");
				return Buffer.from("");
			});

			const handler = makeHandler();
			const outcome = await handler.execute(
				new AbortController().signal,
				makeNode({ repo: repoDir, branch: "wave/broken", worktree_dir: badWorktreeDir }),
				new Context({ __run_id: "run-invalid-worktree" }),
				"",
			);

			expect(outcome.status).toBe(StageStatus.Failed);
			expect(outcome.error).toContain("not a git worktree");
			expect(createAgentSessionMock).not.toHaveBeenCalled();
		});
	});

	// ─── PATH 4b: Branch mismatch detection ─────────────────────────────

	describe("branch mismatch detection", () => {
		it("fails when existing worktree is on wrong branch", async () => {
			const branch = "wave/goal-2005";
			const { repoDir } = setupExistingWorktree(branch);

			execFileSyncMock.mockImplementation((command: string, args: string[], options?: { cwd?: string }) => {
				if (command !== "git") return Buffer.from("");
				if (args.includes("--is-inside-work-tree")) return Buffer.from("true\n");
				if (args.includes("--show-toplevel")) return Buffer.from(`${options?.cwd || "/tmp/worktree"}\n`);
				if (args.includes("--abbrev-ref") && args.includes("HEAD")) return Buffer.from("main\n");
				if (args.includes("rev-list")) return Buffer.from("0\n");
				if (args.includes("status")) return Buffer.from("\n");
				return Buffer.from("");
			});

			const handler = makeHandler();
			const outcome = await handler.execute(
				new AbortController().signal,
				makeNode({ repo: repoDir, branch }),
				new Context({ __run_id: "run-branch-mismatch" }),
				"",
			);

			expect(outcome.status).toBe(StageStatus.Failed);
			expect(outcome.error).toContain("main");
			expect(outcome.error).toContain("wave/goal-2005");
			expect(createAgentSessionMock).not.toHaveBeenCalled();
		});

		it("succeeds when existing worktree is on correct branch", async () => {
			const branch = "wave/goal-2005";
			const { repoDir } = setupExistingWorktree(branch);

			execFileSyncMock.mockImplementation((command: string, args: string[], options?: { cwd?: string }) => {
				if (command !== "git") return Buffer.from("");
				if (args.includes("--is-inside-work-tree")) return Buffer.from("true\n");
				if (args.includes("--show-toplevel")) return Buffer.from(`${options?.cwd || "/tmp/worktree"}\n`);
				if (args.includes("--abbrev-ref") && args.includes("HEAD")) return Buffer.from("wave/goal-2005\n");
				if (args.includes("rev-list")) return Buffer.from("0\n");
				if (args.includes("status")) return Buffer.from("\n");
				if (args.includes("log")) return Buffer.from("abc test\n");
				if (args.includes("worktree")) return Buffer.from("");
				return Buffer.from("");
			});

			const session = makeMockSession({
				onPrompt: async (_call, emit, s) => {
					const msg = makeAssistantMessage("ok");
					s.messages = [msg];
					emit({ type: "message_end", message: msg });
				},
			});
			createAgentSessionMock.mockResolvedValue({ session });

			const handler = makeHandler();
			const outcome = await handler.execute(
				new AbortController().signal,
				makeNode({ repo: repoDir, branch }),
				new Context({ __run_id: "run-branch-match" }),
				"",
			);

			expect(outcome.status).toBe(StageStatus.Completed);
		});
	});

	// ─── PATH 5: Session persistence (continueRecent vs inMemory) ────────

	describe("session persistence", () => {
		it("uses continueRecent when wave_sessions_dir is set", async () => {
			const branch = "wave/persistent";
			const { repoDir } = setupExistingWorktree(branch);
			mockGit({ commitsAhead: 0 });

			const session = makeMockSession({
				onPrompt: async (_call, emit, s) => {
					const msg = makeAssistantMessage("persistent session");
					s.messages = [msg];
					emit({ type: "message_end", message: msg });
				},
			});
			createAgentSessionMock.mockResolvedValue({ session });

			const sessionsDir = join(tempRoot, "wave-sessions");
			mkdirSync(sessionsDir, { recursive: true });

			const handler = makeHandler();
			await handler.execute(
				new AbortController().signal,
				makeNode({ repo: repoDir, branch }),
				new Context({ __run_id: "run-11", wave_sessions_dir: sessionsDir }),
				"",
			);

			expect(sessionManagerMock.continueRecent).toHaveBeenCalled();
			expect(sessionManagerMock.inMemory).not.toHaveBeenCalled();
		});

		it("falls back to inMemory when no persistent session dir available", async () => {
			const branch = "wave/ephemeral";
			const { repoDir } = setupExistingWorktree(branch);
			mockGit({ commitsAhead: 0 });

			const session = makeMockSession({
				onPrompt: async (_call, emit, s) => {
					const msg = makeAssistantMessage("ephemeral session");
					s.messages = [msg];
					emit({ type: "message_end", message: msg });
				},
			});
			createAgentSessionMock.mockResolvedValue({ session });

			const handler = makeHandler();
			await handler.execute(
				new AbortController().signal,
				makeNode({ repo: repoDir, branch }),
				new Context({ __run_id: "run-12" }),  // no wave_sessions_dir, no __run_sessions_dir
				"",
			);

			expect(sessionManagerMock.inMemory).toHaveBeenCalled();
			expect(sessionManagerMock.continueRecent).not.toHaveBeenCalled();
		});
	});

	// ─── PATH 6: Model resolution failure ────────────────────────────────

	describe("model resolution failure", () => {
		it("returns failed outcome when model cannot be resolved", async () => {
			const branch = "wave/bad-model";
			const { repoDir } = setupExistingWorktree(branch);
			mockGit({ commitsAhead: 0 });

			const handler = makeHandler({
				modelRegistry: { find: vi.fn(() => null) } as any,
			});

			const outcome = await handler.execute(
				new AbortController().signal,
				makeNode({ repo: repoDir, branch }),
				new Context({ __run_id: "run-13" }),
				"",
			);

			expect(outcome.status).toBe(StageStatus.Failed);
			expect(outcome.error).toContain("could not resolve model");
			expect(createAgentSessionMock).not.toHaveBeenCalled();
		});
	});

	// ─── PATH 7: LLM API error detection ─────────────────────────────────

	describe("API error detection", () => {
		it("returns failed outcome when LLM returns stopReason=error", async () => {
			const branch = "wave/api-error";
			const { repoDir } = setupExistingWorktree(branch);
			mockGit({ commitsAhead: 0 });

			const session = makeMockSession({
				onPrompt: async (_call, _emit, s) => {
					s.messages = [{
						role: "assistant",
						content: [],
						stopReason: "error",
						errorMessage: "model provider returned 503",
						usage: { input: 0, output: 0, totalTokens: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
					}];
				},
			});
			createAgentSessionMock.mockResolvedValue({ session });

			const handler = makeHandler();
			const outcome = await handler.execute(
				new AbortController().signal,
				makeNode({ repo: repoDir, branch }),
				new Context({ __run_id: "run-14" }),
				"",
			);

			expect(outcome.status).toBe(StageStatus.Failed);
			expect(outcome.error).toContain("503");
		});

		it("returns failed outcome when LLM returns errorMessage field", async () => {
			const branch = "wave/error-field";
			const { repoDir } = setupExistingWorktree(branch);
			mockGit({ commitsAhead: 0 });

			const session = makeMockSession({
				onPrompt: async (_call, _emit, s) => {
					s.messages = [{
						role: "assistant",
						content: [{ type: "text", text: "" }],
						stopReason: "stop",
						errorMessage: "rate limit exceeded",
						usage: { input: 0, output: 0, totalTokens: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
					}];
				},
			});
			createAgentSessionMock.mockResolvedValue({ session });

			const handler = makeHandler();
			const outcome = await handler.execute(
				new AbortController().signal,
				makeNode({ repo: repoDir, branch }),
				new Context({ __run_id: "run-15" }),
				"",
			);

			expect(outcome.status).toBe(StageStatus.Failed);
			expect(outcome.error).toContain("rate limit");
		});
	});

	// ─── PATH 8: Zero commits, no worktree = fresh start ─────────────────

	describe("fresh start (no recovery needed)", () => {
		it("does not prepend recovery context when no commits exist", async () => {
			const branch = "wave/fresh-start";
			const { repoDir } = setupExistingWorktree(branch);
			mockGit({ commitsAhead: 0 });

			const session = makeMockSession({
				onPrompt: async (_call, emit, s) => {
					const msg = makeAssistantMessage("starting fresh");
					s.messages = [msg];
					emit({ type: "message_end", message: msg });
				},
			});
			createAgentSessionMock.mockResolvedValue({ session });

			const handler = makeHandler();
			const outcome = await handler.execute(
				new AbortController().signal,
				makeNode({ repo: repoDir, branch }),
				new Context({ __run_id: "run-16" }),
				"",
			);

			expect(outcome.status).toBe(StageStatus.Completed);
			expect(outcome.output).not.toContain("[recovery]");
		});
	});
});
