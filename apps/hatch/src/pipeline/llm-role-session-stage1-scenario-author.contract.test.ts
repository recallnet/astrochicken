import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../../");

describe("scenario_author role stylesheet contract", () => {
	it("keeps the mothership role bundle semantics aligned with the prior knowledge_worker role", () => {
		const stylesheet = readFileSync(join(REPO_ROOT, "factories/mothership/roles.stylesheet"), "utf8");

		expect(stylesheet).toMatch(/\.scenario_author\s*\{/);
		expect(stylesheet).toMatch(/llm_provider = "openrouter"/);
		expect(stylesheet).toContain('llm_model = "anthropic/claude-sonnet-4.6"');
		expect(stylesheet).toContain('trust_role = "mothership.local.codergen"');
	});
});
