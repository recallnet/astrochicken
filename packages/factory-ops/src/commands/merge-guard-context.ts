import { trim, parseJson } from "../lib/cli-helpers.ts";
import { buildGuardRepoRoleOptions, normalizeRepoSlug } from "../lib/factory-repo-roles.ts";

function resolveMergeMutationContextFromEnv() {
  const raw = trim(process.env.HATCH_FACTORY_MUTATION_CONTEXT_JSON || "");
  if (!raw) return null;
  const parsed = parseJson(raw, null);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
}

export function resolveRepoRoleGuardOptions({ repo = "", fallbackRepoSlug = "" } = {}) {
  const fallback = trim(fallbackRepoSlug)
    || trim(process.env.MOTHERSHIP_REPO || "")
    || trim(process.env.HATCH_TARGET_REPO || "")
    || trim(process.env.HATCH_TARGET_REPO || "")
    || trim(process.env.HATCH_CONTROL_PLANE_REPO || "");
  return {
    ...buildGuardRepoRoleOptions({
      repoSlug: normalizeRepoSlug(repo),
      fallbackRepoSlug: fallback,
      enforceWhenContextPresent: true,
    }),
    mutationContext: resolveMergeMutationContextFromEnv(),
  };
}
