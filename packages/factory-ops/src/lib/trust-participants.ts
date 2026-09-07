export const TRUST_DOMAIN_KEY = "trust_domain";
export const TRUST_ROLE_KEY = "trust_role";
export const LEGACY_TRUST_IDENTITY_KEY = "trust_participant";

export const LOCAL_INTENTS_TRUST_DOMAIN = "mothership.local";
export const LOCAL_INTENTS_TRUST_ROLE_NAMESPACE = "mothership.local";

const TRUST_DOMAIN_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const TRUST_ROLE_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\.[a-z0-9]+(?:[._-][a-z0-9]+)*)+$/;

export const TRUST_ROLE_BY_HANDLER_TYPE = Object.freeze({
  codergen: `${LOCAL_INTENTS_TRUST_ROLE_NAMESPACE}.codergen`,
  tool: `${LOCAL_INTENTS_TRUST_ROLE_NAMESPACE}.tool`,
  "agent.worktree": `${LOCAL_INTENTS_TRUST_ROLE_NAMESPACE}.agent.worktree`,
  "stack.manager_loop": `${LOCAL_INTENTS_TRUST_ROLE_NAMESPACE}.stack.manager_loop`,
  pipeline: `${LOCAL_INTENTS_TRUST_ROLE_NAMESPACE}.pipeline`,
  "fan_out.dynamic": `${LOCAL_INTENTS_TRUST_ROLE_NAMESPACE}.fan_out.dynamic`,
  "fan_in.dynamic": `${LOCAL_INTENTS_TRUST_ROLE_NAMESPACE}.fan_in.dynamic`,
});

export const TRUST_ROLE_ALLOWLIST = new Set(Object.values(TRUST_ROLE_BY_HANDLER_TYPE));
export const TRUST_DOMAIN_ALLOWLIST = new Set([LOCAL_INTENTS_TRUST_DOMAIN]);

export function isTrustParticipatingHandlerType(handlerType) {
  return Object.prototype.hasOwnProperty.call(TRUST_ROLE_BY_HANDLER_TYPE, String(handlerType || ""));
}

export function expectedTrustRoleForHandlerType(handlerType) {
  return TRUST_ROLE_BY_HANDLER_TYPE[String(handlerType || "")] || "";
}

export function expectedTrustIdentityForHandlerType(handlerType) {
  const trustRole = expectedTrustRoleForHandlerType(handlerType);
  if (!trustRole) return null;
  return {
    trust_domain: LOCAL_INTENTS_TRUST_DOMAIN,
    trust_role: trustRole,
  };
}

export function isLegacyTrustIdentityKey(key) {
  return String(key || "").trim() === LEGACY_TRUST_IDENTITY_KEY;
}

export function parseLegacyTrustIdentity(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const slash = raw.indexOf("/");
  if (slash <= 0 || slash >= raw.length - 1) return null;

  const domain = raw.slice(0, slash).trim();
  const role = raw.slice(slash + 1).trim();
  if (!domain || !role) return null;

  return { domain, role };
}

export function isValidTrustDomain(value) {
  return TRUST_DOMAIN_PATTERN.test(String(value || ""));
}

export function isValidTrustRole(value) {
  return TRUST_ROLE_PATTERN.test(String(value || ""));
}

export function shapeToHandlerType(shape) {
  switch (String(shape || "")) {
    case "Mdiamond":
      return "start";
    case "Msquare":
      return "exit";
    case "box":
    case "":
      return "codergen";
    case "hexagon":
      return "wait.human";
    case "diamond":
      return "conditional";
    case "component":
      return "parallel";
    case "tripleoctagon":
      return "parallel.fan_in";
    case "parallelogram":
      return "tool";
    case "house":
      return "stack.manager_loop";
    case "octagon":
      return "assert";
    default:
      return "codergen";
  }
}

export function resolveHandlerTypeFromAttrs(attrs = {}) {
  const explicit = String(attrs?.type || "").trim();
  if (explicit) return explicit;
  return shapeToHandlerType(String(attrs?.shape || ""));
}
