import { describe, expect, it } from "vitest";

import { Context } from "../index.js";
import { buildGitHubMutationContext } from "./github-mutation-context.js";

describe("buildGitHubMutationContext", () => {
	it("builds stable mutation identity from pipeline context", () => {
		const request = {
			ctx: new Context({
				factory_id: "example-trading",
				__run_id: "run-123",
			}),
			env: {},
		};

		const result = buildGitHubMutationContext(request as never);
		expect(result.instance_id).toBe("example-trading");
		expect(result.run_id).toBe("run-123");
		expect(result.installation_id).toBe("inst_example-trading");
	});
});
