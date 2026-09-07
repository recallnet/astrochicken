import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

interface CapabilityContract {
  entrypoints: { kind: string; path: string }[];
  skillPaths: string[];
  requiredContextKeys: string[];
  requiredRoles: string[];
  requiredHandlers: string[];
}

const CAPABILITY_ROOT = resolve(import.meta.dirname, "../../../../packages/capability-brainstorming");
const CAPABILITY_CONTRACT_PATH = join(CAPABILITY_ROOT, "capability-manifest.v1.json");

function loadContract(): CapabilityContract {
  const raw = readFileSync(CAPABILITY_CONTRACT_PATH, "utf8");
  return JSON.parse(raw) as CapabilityContract;
}

function declaredGraphs(contract: CapabilityContract): string[] {
  return contract.entrypoints.filter((entrypoint) => entrypoint.kind === "graph").map((entrypoint) => entrypoint.path);
}

function collectDotFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectDotFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".dot")) {
      files.push(relative(CAPABILITY_ROOT, fullPath).replaceAll("\\", "/"));
    }
  }
  return files.sort();
}

describe("@hatch/capability-brainstorming manifest contract", () => {
  it("every declared graph path exists on disk", () => {
    const contract = loadContract();
    for (const graphPath of declaredGraphs(contract)) {
      const fullPath = join(CAPABILITY_ROOT, graphPath);
      expect(existsSync(fullPath), `declared graph missing: ${graphPath}`).toBe(true);
    }
  });

  it("every declared skill path exists on disk", () => {
    const contract = loadContract();
    for (const skillPath of contract.skillPaths) {
      const fullPath = join(CAPABILITY_ROOT, skillPath);
      expect(existsSync(fullPath), `declared skill missing: ${skillPath}`).toBe(true);
    }
  });

  it("has no undeclared .dot files in graphs/", () => {
    const contract = loadContract();
    const graphDotFiles = collectDotFiles(join(CAPABILITY_ROOT, "graphs"));
    expect(graphDotFiles.length).toBeGreaterThan(0);
    for (const dotPath of graphDotFiles) {
      expect(declaredGraphs(contract)).toContain(dotPath);
    }
  });

  it("requiredContextKeys includes brainstorming contract keys", () => {
    const contract = loadContract();
    expect(contract.requiredContextKeys).toContain("brainstorm_issue_number");
    expect(contract.requiredContextKeys).toContain("brainstorm_issue_body");
    expect(contract.requiredContextKeys).toContain("capability_brainstorming_skills");
    expect(contract.requiredContextKeys).toContain("trust_domain");
    expect(contract.requiredContextKeys).toContain("trust_role");
  });

  it("requiredRoles contains .red_strategist and .blue_strategist", () => {
    const contract = loadContract();
    expect(contract.requiredRoles).toContain(".red_strategist");
    expect(contract.requiredRoles).toContain(".blue_strategist");
  });

  it("requiredHandlers includes agent.kw and tool", () => {
    const contract = loadContract();
    expect(Array.isArray(contract.requiredHandlers)).toBe(true);
    expect(contract.requiredHandlers).toContain("agent.kw");
    expect(contract.requiredHandlers).toContain("tool");
  });
});
