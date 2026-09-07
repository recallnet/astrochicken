import { resolveDefault } from "./common-resolve-default.ts";

/**
 * Resolve all wave_execute config defaults in a single call.
 * Replaces three separate resolve-default tool nodes:
 *   - set_integration_command
 *   - set_review_qa_command
 *   - set_stale_run_minutes
 */
export function resolveWaveConfig({
  integrationCommand = "",
  reviewQaCommand = "",
  stalledWaveMinutes = "",
} = {}) {
  const resolved_integration_command = resolveDefault(
    integrationCommand,
    "./node_modules/.bin/turbo run test --continue --output-logs=errors-only",
  );
  const resolved_review_qa_command = resolveDefault(
    reviewQaCommand,
    resolved_integration_command,
  );
  const resolved_stale_run_minutes = resolveDefault(
    stalledWaveMinutes,
    "20",
  );
  return {
    integration_command: resolved_integration_command,
    review_qa_command: resolved_review_qa_command,
    stale_run_minutes: resolved_stale_run_minutes,
  };
}
