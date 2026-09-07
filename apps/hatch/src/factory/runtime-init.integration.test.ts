import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runFactoryInit } from "./init.js";
import { updateFactoryRegistry } from "./registry-update.js";
import { ensureFactoryTrackingIssue } from "./tracking-issue.js";

function seedTemplate(root: string) {
  const templateRoot = join(root, "factories", "_templates", "factory");
  const policyPackTemplateRoot = join(root, "factories", "_templates", "policy-pack", "v1");
  mkdirSync(join(templateRoot, "scripts"), { recursive: true });
  mkdirSync(join(templateRoot, "graphs"), { recursive: true });
  mkdirSync(join(templateRoot, "scenarios", "__FACTORY_ID__"), { recursive: true });
  mkdirSync(join(templateRoot, "docs"), { recursive: true });
  mkdirSync(policyPackTemplateRoot, { recursive: true });

  writeFileSync(join(templateRoot, "factory.config.json.template"), JSON.stringify({
    schema: "hatch.factory.config.v1",
    factory_id: "{{factory_id}}",
    instance_id: "{{instance_id}}",
    target_repo: "{{target_repo}}",
    control_plane_repo: "{{control_plane_repo}}",
    dispatch: { graph: "{{dispatch_graph}}" },
    skills: { supervisor: "packages/factory-skills/skills/runtime/supervisor_review/SKILL.md" },
    scenarios: { root: "factories/{{factory_id}}/scenarios/{{factory_id}}" },
    pipeline: { supervisor_tick: "{{dispatch_graph}}" },
    runs_dir: "{{runs_dir}}",
    policyPack: { version: "v1", overrides: {} },
    trust: { domain: "{{trust_domain}}", roles: ["{{trust_domain}}.tool", "{{trust_domain}}.codergen"] },
  }, null, 2) + "\n");
  writeFileSync(join(templateRoot, "scripts", "factory_daemon.sh.template"), "#!/usr/bin/env bash\nexit 0\n");
  writeFileSync(join(templateRoot, "docs", "factory-create-evolve.md.template"), "init {{factory_id}} {{target_repo}} {{control_plane_repo}}\n");
  writeFileSync(join(templateRoot, "INTENT.md.template"), "# {{factory_name}} / {{target_repo}}\n");
  writeFileSync(join(templateRoot, "graphs", ".gitkeep.template"), "");
  writeFileSync(join(templateRoot, "scenarios", "__FACTORY_ID__", ".gitkeep.template"), "");

  writeFileSync(join(policyPackTemplateRoot, "metadata.json"), JSON.stringify({
    version: "v1",
    owned_by: "factory-platform",
    files: {
      supervisor: "supervisor-policy.json",
      review: "reviewer-policy.json",
    },
    required_keys: {
      supervisor: ["shared.max_review_retries"],
      review: ["shared.verdict_schema.required_fields", "shared.review.visual_refinement.required_metadata"],
    },
    customizable_keys: {
      supervisor: ["factory.max_review_retries"],
      review: [
        "factory.qa.required_command",
        "factory.qa.visual_refinement.required_command",
        "factory.qa.visual_refinement.additional_evidence",
      ],
    },
  }, null, 2));
  writeFileSync(join(policyPackTemplateRoot, "supervisor-policy.json"), JSON.stringify({
    shared: { max_review_retries: 2 },
    factory: { max_review_retries: 2 },
  }, null, 2));
  writeFileSync(join(policyPackTemplateRoot, "reviewer-policy.json"), JSON.stringify({
    shared: {
      verdict_schema: { required_fields: ["status"] },
      review: { visual_refinement: { required_metadata: ["visual_risk_class"] } },
    },
    factory: {
      qa: {
        required_command: "pnpm test",
        visual_refinement: {
          required_command: "npm run qa",
          additional_evidence: ["scenario_root_reference"],
        },
      },
    },
  }, null, 2));
}

describe("factory runtime init surfaces", () => {
  const cleanupDirs: string[] = [];
  const originalPath = process.env.PATH;

  afterEach(() => {
    for (const dir of cleanupDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    process.env.PATH = originalPath;
    vi.restoreAllMocks();
  });

  it("updateFactoryRegistry upserts and preserves existing graph wiring", () => {
    const root = mkdtempSync(join(tmpdir(), "factory-registry-update-"));
    cleanupDirs.push(root);
    const registryPath = join(root, "factory-registry.json");
    writeFileSync(registryPath, JSON.stringify({
      schema: "hatch.factory.registry.v1",
      factories: [{
        id: "example-trading",
        repo: "example-org/example-trading",
        graphs: [{ id: "custom", path: "factories/example-trading/graphs/custom.dot" }],
      }],
    }, null, 2));

    const out = updateFactoryRegistry({
      rootDir: root,
      factoryId: "example-trading",
      instanceId: "fac_01JQ7M8JABCDEFG",
      targetRepo: "example-org/example-trading",
      controlPlaneRepo: "recallnet/astrochicken",
      dispatchGraphPath: "factories/example-trading/graphs/factory_supervisor_tick.dot",
    });

    expect(out.path).toBe(registryPath);
    expect(out.entry.instance_id).toBe("fac_01JQ7M8JABCDEFG");
    expect(out.entry.target_repo).toBe("example-org/example-trading");
    expect(out.entry.graphs).toEqual([{ id: "custom", path: "factories/example-trading/graphs/custom.dot" }]);
    expect(out.entry.daemonStatus).toEqual({ status: "stopped" });
    expect(out.entry.service_tier).toBe("standard");
    expect(out.entry.scheduler_weight).toBe(1);
    expect(out.entry.reserved_capacity).toBe(0);
    expect(out.entry.upgrade_channel).toBe("stable");
    expect(out.entry.allowed_runtime_version).toBe("*");
    expect(out.entry.support_owner).toBe("ops");
    expect(out.entry.feature_flags).toEqual({});
  });

  it("ensureFactoryTrackingIssue reuses existing issues and creates missing ones", () => {
    const execReuse = vi.fn(() => JSON.stringify([
      { title: "Factory Tracking: example-trading", url: "https://github.com/example-org/example-trading/issues/42" },
    ]));
    expect(ensureFactoryTrackingIssue({
      repo: "example-org/example-trading",
      factoryId: "example-trading",
      controlPlaneRepo: "recallnet/astrochicken",
      execFileSyncFn: execReuse as any,
    })).toEqual({
      url: "https://github.com/example-org/example-trading/issues/42",
      number: 42,
      created: false,
    });

    const execCreate = vi.fn()
      .mockReturnValueOnce("[]")
      .mockReturnValueOnce("https://github.com/example-org/example-trading/issues/43\n");
    expect(ensureFactoryTrackingIssue({
      repo: "example-org/example-trading",
      factoryId: "example-trading",
      controlPlaneRepo: "recallnet/astrochicken",
      execFileSyncFn: execCreate as any,
    })).toEqual({
      url: "https://github.com/example-org/example-trading/issues/43",
      number: 43,
      created: true,
    });
  });

  it("runFactoryInit executes end-to-end with a gh shim and logs the result", async () => {
    const root = mkdtempSync(join(tmpdir(), "factory-run-init-"));
    const binDir = join(root, "bin");
    cleanupDirs.push(root);
    seedTemplate(root);
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(root, "factory-registry.json"), JSON.stringify({ schema: "hatch.factory.registry.v1", factories: [] }, null, 2));
    writeFileSync(join(binDir, "gh"), `#!/usr/bin/env node
const args = process.argv.slice(2).join(" ");
if (args.includes("issue list")) process.stdout.write("[]\\n");
else if (args.includes("issue create")) process.stdout.write("https://github.com/example-org/example-trading/issues/44\\n");
else process.exit(1);
`);
    chmodSync(join(binDir, "gh"), 0o755);
    process.env.PATH = `${binDir}:${originalPath || ""}`;

    const logs = vi.spyOn(console, "log").mockImplementation(() => {});

    await runFactoryInit([
      "--id", "example-trading",
      "--repo", "example-org/example-trading",
      "--control-plane", "recallnet/astrochicken",
      "--root-dir", root,
    ]);

    expect(readFileSync(join(root, "factories", "example-trading", "factory.config.json"), "utf8")).toContain("\"factory_id\": \"example-trading\"");
    expect(readFileSync(join(root, "factories", "example-trading", "factory.config.json"), "utf8")).toMatch(/"instance_id": "fac_[0-9A-HJKMNP-TV-Z]{16}"/);
    expect(readFileSync(join(root, "factory-registry.json"), "utf8")).toContain("\"id\": \"example-trading\"");
    expect(readFileSync(join(root, "factory-registry.json"), "utf8")).toMatch(/"instance_id": "fac_[0-9A-HJKMNP-TV-Z]{16}"/);
    expect(logs).toHaveBeenCalledWith("Initialized factory example-trading");
    expect(logs).toHaveBeenCalledWith(expect.stringMatching(/instance_id: fac_[0-9A-HJKMNP-TV-Z]{16}/));
    expect(logs).toHaveBeenCalledWith(expect.stringContaining("tracking_issue: https://github.com/example-org/example-trading/issues/44"));
  });
});
