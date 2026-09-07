import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Shell-safety contract for DOT tool nodes.
 *
 * The Hatch engine's expandToolCommandViaEnv converts context variable
 * references (${key}) into env var references (${HATCH_VAR_KEY}) and passes
 * actual values as environment variables to `sh -c`. This mechanism is
 * inherently safe: parameter expansion of env vars does NOT re-interpret
 * the expanded value for command substitution, so backticks and $() in
 * issue titles or review notes are inert.
 *
 * BROKEN PATTERN (single-quoted heredoc prevents env var expansion):
 *   cat > "$TMP" <<'EOF'
 *   ${var}                      ← engine writes ${HATCH_VAR_X}, but shell
 *   EOF                            does NOT expand inside <<'...' heredoc
 *   B64=$(base64 < "$TMP")
 *   hatch-ops ... --flag-b64 "$B64"
 *
 * CORRECT PATTERN (engine's env var expansion works as designed):
 *   hatch-ops ... --flag "${var}"
 *
 * This contract rejects any tool node that uses the broken heredoc+b64
 * encoding pattern for context variable transport.
 */

const GRAPHS_DIR = "factories/mothership/graphs";

const NODE_BLOCK_RE = /(\w+)\s*\[([^\]]*type\s*=\s*"tool"[^\]]*)\]/g;

function getGraphFiles() {
  return readdirSync(GRAPHS_DIR)
    .filter((f) => f.endsWith(".dot"))
    .map((f) => join(GRAPHS_DIR, f));
}

test("no DOT tool node uses single-quoted heredoc for context variable transport", () => {
  // The pattern: <<'DELIM'\n${some_var}\nDELIM inside a prompt attribute
  // This is broken because the engine converts ${var} to ${HATCH_VAR_X}
  // but single-quoted heredoc prevents shell expansion.
  const HEREDOC_VAR_PATTERN = /<<'[A-Z_]+'\s*\\n\$\{[^}]+\}\s*\\n[A-Z_]+/;

  const violations = [];

  for (const graphPath of getGraphFiles()) {
    const dot = readFileSync(graphPath, "utf8");
    let match;
    NODE_BLOCK_RE.lastIndex = 0;

    while ((match = NODE_BLOCK_RE.exec(dot)) !== null) {
      const nodeName = match[1];
      const attrs = match[2];

      const promptMatch = attrs.match(/prompt\s*=\s*"([\s\S]*?)"\s*trust_domain/);
      if (!promptMatch) continue;

      const prompt = promptMatch[1];
      if (HEREDOC_VAR_PATTERN.test(prompt)) {
        violations.push({ graph: graphPath, node: nodeName });
      }
    }
  }

  assert.equal(
    violations.length,
    0,
    `Found ${violations.length} tool node(s) using broken heredoc+b64 variable transport:\n` +
      violations
        .map(
          (v) =>
            `  ${v.graph}::${v.node}\n` +
            `    → Use direct "\${'{'}var}" instead; engine env var expansion is shell-safe`,
        )
        .join("\n"),
  );
});

test("no DOT tool node passes mktemp/base64 boilerplate for variable encoding", () => {
  // Secondary check: look for the mktemp pattern that always accompanies
  // the broken heredoc approach.
  const MKTEMP_B64_PATTERN = /mktemp.*taxi.*base64/;

  const violations = [];

  for (const graphPath of getGraphFiles()) {
    const dot = readFileSync(graphPath, "utf8");
    let match;
    NODE_BLOCK_RE.lastIndex = 0;

    while ((match = NODE_BLOCK_RE.exec(dot)) !== null) {
      const nodeName = match[1];
      const attrs = match[2];

      const promptMatch = attrs.match(/prompt\s*=\s*"([\s\S]*?)"\s*trust_domain/);
      if (!promptMatch) continue;

      const prompt = promptMatch[1];
      if (MKTEMP_B64_PATTERN.test(prompt)) {
        violations.push({ graph: graphPath, node: nodeName });
      }
    }
  }

  assert.equal(
    violations.length,
    0,
    `Found ${violations.length} tool node(s) using mktemp+base64 boilerplate:\n` +
      violations
        .map((v) => `  ${v.graph}::${v.node}`)
        .join("\n"),
  );
});
