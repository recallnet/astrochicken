import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import { Context, StageStatus, type Outcome } from "./context.js";
import { Engine, HandlerRegistry, type Handler } from "./engine.js";
import { parse } from "./parse.js";

import type { Node } from "./graph.js";

const DOMAIN_BRAINSTORM_DOT_PATH = join(
  import.meta.dirname,
  "../../../../docs/contracts/workflow-ir/brainstorm/domain_brainstorm.dot",
);

class StartDoneHandler implements Handler {
  async execute(): Promise<Outcome> {
    return { status: StageStatus.Completed, output: "" };
  }
}

class MockToolHandler implements Handler {
  async execute(_signal: AbortSignal, node: Node, ctx: Context): Promise<Outcome> {
    if (node.id === "set_factory_root") return { status: StageStatus.Completed, output: "factories/brainstorm" };
    if (node.id === "set_gh_repo") return { status: StageStatus.Completed, output: "example-org/example-notes" };
    if (node.id === "set_repo") return { status: StageStatus.Completed, output: "." };
    if (node.id === "set_control_plane_repo") return { status: StageStatus.Completed, output: "recallnet/astrochicken" };
    if (node.id === "set_trust_domain") return { status: StageStatus.Completed, output: "brainstorm.local" };
    if (node.id === "set_trust_role") return { status: StageStatus.Completed, output: "brainstorm.local.tool" };
    if (node.id === "load_intent_stack") return { status: StageStatus.Completed, output: "{\"intent_stack_summary\":\"ok\"}" };
    if (node.id === "set_capability_brainstorming_skills") return { status: StageStatus.Completed, output: "skills" };

    if (node.id === "build_intake_context") {
      const intake = JSON.parse(ctx.get("intake_json") || "{}");
      const issue = intake?.issue || null;
      const hasIssue = Number.isFinite(Number.parseInt(String(issue?.number ?? "").trim(), 10));
      return {
        status: StageStatus.Completed,
        output: JSON.stringify({
          has_issue: hasIssue ? "true" : "false",
          brainstorm_issue_number: hasIssue ? String(issue.number) : "",
          brainstorm_issue_body: hasIssue ? String(issue.body || "") : "",
          shipped_goals_since_last: "[]",
          open_backlog_summary: "{}",
          scenario_holdouts: "[]",
          parse_error: "",
        }),
      };
    }

    if (node.id === "context_contract_preflight") {
      // Real tool concatenates all context vars; non-empty means preflight passed.
      // Returns the fallback token "context_contract_preflight_ok" only when vars are empty (failure).
      const concat = [
        ctx.get("factory_root"), ctx.get("gh_repo"), ctx.get("repo"),
        ctx.get("intent_stack"), ctx.get("capability_brainstorming_skills"),
        ctx.get("trust_domain"), ctx.get("trust_role"),
        ctx.get("brainstorm_issue_number"), ctx.get("brainstorm_issue_body"),
        ctx.get("shipped_goals_since_last"), ctx.get("open_backlog_summary"),
        ctx.get("scenario_holdouts"), ctx.get("has_issue"), ctx.get("parse_error"),
      ].join("");
      return { status: StageStatus.Completed, output: concat || "context_contract_preflight_ok" };
    }

    if (node.id === "set_domain_result") {
      return {
        status: StageStatus.Completed,
        output: JSON.stringify({
          has_issue: ctx.get("has_issue"),
          brainstorm_issue_number: ctx.get("brainstorm_issue_number"),
        }),
      };
    }

    return { status: StageStatus.Completed, output: "" };
  }
}

class MockPipelineHandler implements Handler {
  public calls = 0;
  public payloads: Array<{ issueNumber: string; issueBody: string }> = [];

  async execute(_signal: AbortSignal, _node: Node, ctx: Context): Promise<Outcome> {
    this.calls += 1;
    this.payloads.push({
      issueNumber: ctx.get("brainstorm_issue_number"),
      issueBody: ctx.get("brainstorm_issue_body"),
    });

    return {
      status: StageStatus.Completed,
      output: "",
      contextUpdates: {
        brainstorm_close_result: "ok",
      },
    };
  }
}

describe("brainstorm shell intake integration", () => {
  it("invokes capability exactly once with shell-selected issue context", async () => {
    const domainDot = readFileSync(DOMAIN_BRAINSTORM_DOT_PATH, "utf8");
    const graph = parse(domainDot);
    const registry = new HandlerRegistry();
    const toolHandler = new MockToolHandler();
    const pipelineHandler = new MockPipelineHandler();

    registry.register("start", new StartDoneHandler());
    registry.register("exit", new StartDoneHandler());
    registry.register("tool", toolHandler);
    registry.register("conditional", new StartDoneHandler());
    registry.register("pipeline", pipelineHandler);

    const engine = new Engine(graph, registry, {
      context: new Context({
        intake_json: JSON.stringify({
          issue_selector: { labels: ["hatch:intake"] },
          has_issue: true,
          issue: {
            number: 1201,
            source_issue_id: "1201",
            title: "Selected by shell",
            body: "selected body",
            labels: ["hatch:intake"],
          },
        }),
      }),
    });

    await engine.run();

    expect(pipelineHandler.calls).toBe(1);
    expect(pipelineHandler.payloads).toEqual([{ issueNumber: "1201", issueBody: "selected body" }]);
    expect(engine.getContext().get("brainstorm_close_result")).toBe("ok");
  });

  it("contains no fallback intake selection path in domain graph", () => {
    const domainDot = readFileSync(DOMAIN_BRAINSTORM_DOT_PATH, "utf8");
    const graph = parse(domainDot);

    expect(Object.keys(graph.nodes)).not.toContain("select_or_refresh_brainstorm_issue");
    expect(domainDot).not.toContain("hatch-ops brainstorm next-issue");
    expect(Object.keys(graph.nodes)).toContain("build_intake_context");
  });
});
