import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { readFactoryTelemetryIdentityForRun } from "./cli/run-config.js";
import { Context } from "./pipeline/context.js";
import { expandVariables } from "./pipeline/engine.js";

const originalArgv = process.argv;

describe("runtime helper surfaces", () => {
  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it("readFactoryTelemetryIdentityForRun validates nearest factory config", () => {
    const root = mkdtempSync(join(tmpdir(), "hatch-runtime-helpers-"));
    const factoryRoot = join(root, "factories", "demo-factory");
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(factoryRoot, "graphs"), { recursive: true });
    writeFileSync(join(factoryRoot, "factory.config.json"), JSON.stringify({
      schema: "hatch.factory.config.v1",
      factory_id: "demo-factory",
      target_repo: "example-org/demo",
      control_plane_repo: "recallnet/astrochicken",
      dispatch: { graph: "factories/demo-factory/graphs/factory_supervisor_tick.dot" },
      skills: { supervisor: "packages/factory-skills/skills/runtime/supervisor_review/SKILL.md" },
      scenarios: { root: "factories/demo-factory/scenarios/demo-factory" },
      pipeline: { supervisor_tick: "factories/demo-factory/graphs/factory_supervisor_tick.dot" },
      runs_dir: ".hatch/demo-factory/runs",
      trust: { domain: "demo-factory.local", roles: ["demo-factory.local.tool"] },
    }, null, 2));
    const pipelinePath = join(factoryRoot, "graphs", "factory_supervisor_tick.dot");
    writeFileSync(pipelinePath, "digraph test {}\n");

    const identity = readFactoryTelemetryIdentityForRun(pipelinePath);
    expect(identity.factory_id).toBe("demo-factory");
    expect(identity.repo).toBe("example-org/demo");
    expect(identity.validation.status).toBe("valid");
  });

  it("createPipelineToolEnv derives shared tool environment from graph workdir", async () => {
    const root = mkdtempSync(join(tmpdir(), "hatch-create-tool-env-"));
    const factoryRoot = join(root, "factories", "demo-factory");
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(factoryRoot, { recursive: true });
    writeFileSync(join(root, "factory.config.json"), "{}\n");

    process.argv = ["node", "cli", "help"];
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => undefined) as any);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const cli = await import("./cli.js");

    const env = cli.createPipelineToolEnv({
      name: "demo",
      attrs: { workdir: "factories/demo-factory" },
      nodes: {},
      edges: [],
    }, join(factoryRoot, "graphs", "factory_supervisor_tick.dot"));

    expect(env.HATCH_WORKDIR).toBe(join(process.cwd(), "factories", "demo-factory"));
    expect(env.HATCH_PIPELINE_FILE).toContain("factory_supervisor_tick.dot");
    expect(env.FACTORY_REPO).toBe(root);
    expect(env.FACTORY_CONFIG_PATH).toBe(join(root, "factory.config.json"));
    expect(exitSpy).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });

  it("expandVariables substitutes context keys and preserves missing values as blanks", () => {
    const ctx = new Context({
      repo: "recallnet/astrochicken",
      issue_number: "1551",
    });

    expect(expandVariables("repo=${repo} issue=${issue_number}", ctx)).toBe("repo=recallnet/astrochicken issue=1551");
    expect(expandVariables("missing=${not_set}", ctx)).toBe("missing=");
  });
});
