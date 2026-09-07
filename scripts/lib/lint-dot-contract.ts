export const LINT_DOT_MARKER_PREFIX = "[lint-dot]";

export const LINT_DOT_RESULT = Object.freeze({
  ok: "ok",
  warningOnly: "warning_only",
  fail: "fail",
});

function normalizeCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
}

export function formatLintDotSummary({ result, target, diagnostics = 0, errors = 0, warnings = 0 }) {
  return [
    LINT_DOT_MARKER_PREFIX,
    `result=${String(result || LINT_DOT_RESULT.fail)}`,
    `target=${JSON.stringify(String(target || ""))}`,
    `diagnostics=${normalizeCount(diagnostics)}`,
    `errors=${normalizeCount(errors)}`,
    `warnings=${normalizeCount(warnings)}`,
  ].join(" ");
}
