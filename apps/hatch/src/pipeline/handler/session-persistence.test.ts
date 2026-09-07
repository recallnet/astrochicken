import { describe, expect, it } from "vitest";

import { Context } from "../context.js";
import {
	resolvePersistentSessionDir,
	resolveSessionKey,
	sanitizeSessionPath,
} from "./session-persistence.js";

describe("session persistence helpers", () => {
	it("sanitizes session keys for filesystem storage", () => {
		expect(sanitizeSessionPath("review/current#1")).toBe("review_current_1");
	});

	it("prefers explicit session IDs over node IDs", () => {
		expect(resolveSessionKey("goal_analysis", "review")).toBe("goal_analysis");
		expect(resolveSessionKey("", "review")).toBe("review");
	});

	it("resolves run session directories by default", () => {
		const ctx = new Context({ __run_sessions_dir: "/tmp/run/sessions" });
		expect(resolvePersistentSessionDir(ctx, "review")).toBe("/tmp/run/sessions/review");
	});

	it("prefers wave session directories when requested", () => {
		const ctx = new Context({
			wave_sessions_dir: "/tmp/wave/sessions",
			__run_sessions_dir: "/tmp/run/sessions",
		});
		expect(resolvePersistentSessionDir(ctx, "milestone-goal-1-wave-1", { preferWaveSessions: true }))
			.toBe("/tmp/wave/sessions/milestone-goal-1-wave-1");
	});
});
