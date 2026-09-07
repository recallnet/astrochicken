export const TOOL_DECLARATIVE_PROMPT_POLICY_RULE_ID = "tool.prompt.declarative_policy";
export const PROMPT_SHELL_METASYNTAX_RULE_ID = "prompt.shell_metasyntax";

const TOOL_OUTPUT_METADATA_ATTRIBUTE_ALIASES = Object.freeze(["output_key", "output_keys", "outputs"]);

const TOOL_OUTPUT_METADATA_ALLOWLIST = Object.freeze([
  Object.freeze({
    id: "noop_colon",
    reason: "allowlisted_noop_router",
    normalizedPromptRegex: /^:\s*(?:;\s*)*$/,
  }),
]);

const TOOL_MUTABLE_HEURISTICS = Object.freeze([
  Object.freeze({ id: "gh_issue_mutation", regex: /\bgh\s+issue\s+(create|edit|close|comment|reopen)\b/ }),
  Object.freeze({ id: "gh_pr_mutation", regex: /\bgh\s+pr\s+(create|edit|merge|close|reopen|review)\b/ }),
  Object.freeze({ id: "gh_label_create", regex: /\bgh\s+label\s+create\b/ }),
  Object.freeze({ id: "git_history_mutation", regex: /\bgit\s+(-C\s+\S+\s+)?(push|commit|merge|rebase|cherry-pick|reset\b|tag\b|branch\s+-D\b|worktree\s+(add|remove)\b)/ }),
  Object.freeze({ id: "filesystem_mutation", regex: /\b(rm|mv|cp|mkdir|touch|chmod|chown)\b/ }),
  Object.freeze({ id: "redirect_write", regex: /(^|[^<])>(>|\s)/ }),
]);

const TOOL_READ_ONLY_HEURISTICS = Object.freeze([
  Object.freeze({ id: "echo", regex: /^echo\b/ }),
  Object.freeze({ id: "printf", regex: /^printf\b/ }),
  Object.freeze({ id: "cat", regex: /^cat\b/ }),
  Object.freeze({ id: "gh_issue_list_view", regex: /\bgh\s+issue\s+(list|view)\b/ }),
  Object.freeze({ id: "gh_pr_list_view", regex: /\bgh\s+pr\s+(list|view)\b/ }),
]);

const TOOL_SHELL_METASYNTAX_PATTERNS = Object.freeze([
  Object.freeze({ token: "2>&1", regex: /2>\s*&1/ }),
  Object.freeze({ token: "&&", regex: /&&/ }),
  Object.freeze({ token: "||", regex: /\|\|/ }),
  Object.freeze({ token: "<<-", regex: /<<-/ }),
  Object.freeze({ token: "<<", regex: /<<(?!-)/ }),
  Object.freeze({ token: ">>", regex: />>/ }),
  Object.freeze({ token: "2>", regex: /2>(?!\s*&1)/ }),
  Object.freeze({ token: "|", regex: /(?<!\|)\|(?!\|)/ }),
  Object.freeze({ token: ";", regex: /;/ }),
  Object.freeze({ token: ">", regex: />(?!>)/ }),
  Object.freeze({ token: "<", regex: /<(?!<)/ }),
  Object.freeze({ token: "$(", regex: /\$\(/ }),
  Object.freeze({ token: "`", regex: /`/ }),
]);

const TOOL_DECLARATIVE_PROMPT_FORBIDDEN_TOKEN_PATTERNS = Object.freeze([
  Object.freeze({ token: "newline_separator", regex: /\r|\n/ }),
  ...TOOL_SHELL_METASYNTAX_PATTERNS,
]);

const LITERAL_COMMAND_TOKEN_REGEX = /^[A-Za-z0-9_./:@%+=-]+$/;

export function normalizeToolPromptForPolicy(promptText) {
  return String(promptText || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function maskContextPlaceholdersForPolicy(text) {
  return String(text || "").replace(/\$\{\s*context\.[^}\s]+\s*\}/g, "__CTX_PLACEHOLDER__");
}

function stripLeadingPolicyComments(normalizedPrompt) {
  const text = String(normalizedPrompt || "").trim();
  if (!text) return "";
  return text
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .join(" ")
    .trim();
}

function firstCommandToken(normalizedPrompt) {
  const text = stripLeadingPolicyComments(normalizedPrompt);
  if (!text) return "";
  const [token = ""] = text.split(/\s+/, 1);
  return token;
}

function findForbiddenTokenViolation({ patterns, rawText, normalizedText }) {
  for (const entry of patterns) {
    if (entry.regex.test(rawText) || entry.regex.test(normalizedText)) {
      return { forbiddenToken: entry.token };
    }
  }
  return null;
}

function validateCommandToken(commandToken) {
  const token = String(commandToken || "").trim();
  if (!token) return { forbiddenToken: "missing_command_token" };
  if (token.includes("${")) return { forbiddenToken: "placeholder_command_token" };

  const tokenForbiddenViolation = findForbiddenTokenViolation({
    patterns: TOOL_DECLARATIVE_PROMPT_FORBIDDEN_TOKEN_PATTERNS,
    rawText: token,
    normalizedText: token,
  });
  if (tokenForbiddenViolation) return tokenForbiddenViolation;

  if (!LITERAL_COMMAND_TOKEN_REGEX.test(token)) return { forbiddenToken: "non_literal_command_token" };
  return null;
}

export function findToolOutputMetadataAllowlistMatch(normalizedPrompt) {
  if (!normalizedPrompt) return null;
  for (const entry of TOOL_OUTPUT_METADATA_ALLOWLIST) {
    if (entry.normalizedPromptRegex.test(normalizedPrompt)) return entry;
  }
  return null;
}

export function resolveToolOutputMetadata(attrs) {
  for (const key of TOOL_OUTPUT_METADATA_ATTRIBUTE_ALIASES) {
    const raw = String(attrs?.[key] || "").trim();
    if (!raw) continue;
    return { key, value: raw };
  }
  return null;
}

export function classifyToolPromptMutability(normalizedPrompt, allowlistMatch) {
  if (allowlistMatch) {
    return {
      kind: "no_op",
      reason: allowlistMatch.reason,
      mutableRuleIds: [],
      readOnlyRuleIds: [],
      precedence: "allowlist_first",
    };
  }

  const mutableRuleIds = TOOL_MUTABLE_HEURISTICS.filter((entry) => entry.regex.test(normalizedPrompt)).map((entry) => entry.id);
  const readOnlyRuleIds = TOOL_READ_ONLY_HEURISTICS.filter((entry) => entry.regex.test(normalizedPrompt)).map((entry) => entry.id);

  if (mutableRuleIds.length > 0) {
    return {
      kind: "mutable",
      reason: "heuristic_mutable",
      mutableRuleIds,
      readOnlyRuleIds,
      precedence: readOnlyRuleIds.length > 0 ? "mutable_over_read_only" : "mutable_only",
    };
  }

  if (readOnlyRuleIds.length > 0) {
    return {
      kind: "read_only",
      reason: "heuristic_read_only",
      mutableRuleIds,
      readOnlyRuleIds,
      precedence: "read_only_only",
    };
  }

  return {
    kind: "unknown",
    reason: "heuristic_unknown",
    mutableRuleIds,
    readOnlyRuleIds,
    precedence: "none",
  };
}

export function findToolShellMetasyntaxViolation({ rawPromptText, normalizedPrompt }) {
  const rawText = String(rawPromptText || "");
  const normalizedText = String(normalizedPrompt || "");
  if (!rawText && !normalizedText) return null;

  const maskedRawText = maskContextPlaceholdersForPolicy(rawText);
  const maskedNormalizedText = maskContextPlaceholdersForPolicy(normalizedText);
  return findForbiddenTokenViolation({
    patterns: TOOL_SHELL_METASYNTAX_PATTERNS,
    rawText: maskedRawText,
    normalizedText: maskedNormalizedText,
  });
}

export function findToolDeclarativePromptViolation({ rawPromptText, normalizedPrompt }) {
  const rawText = String(rawPromptText || "");
  const normalizedText = String(normalizedPrompt || "");
  if (!rawText && !normalizedText) return null;

  const commandTokenViolation = validateCommandToken(firstCommandToken(normalizedText));
  if (commandTokenViolation) return commandTokenViolation;

  const maskedRawText = maskContextPlaceholdersForPolicy(rawText);
  const maskedNormalizedText = maskContextPlaceholdersForPolicy(normalizedText);
  return findForbiddenTokenViolation({
    patterns: TOOL_DECLARATIVE_PROMPT_FORBIDDEN_TOKEN_PATTERNS,
    rawText: maskedRawText,
    normalizedText: maskedNormalizedText,
  });
}

export function promptSnippetForTelemetry(normalizedPrompt) {
  const text = String(normalizedPrompt || "");
  const maxLength = 120;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

export function sortDeclarativeToolTelemetry(entries) {
  return [...entries].sort((left, right) => {
    const fileCmp = left.file.localeCompare(right.file, "en");
    if (fileCmp !== 0) return fileCmp;

    const nodeCmp = left.nodeId.localeCompare(right.nodeId, "en");
    if (nodeCmp !== 0) return nodeCmp;

    const tokenCmp = left.forbiddenToken.localeCompare(right.forbiddenToken, "en");
    if (tokenCmp !== 0) return tokenCmp;

    return left.promptSnippet.localeCompare(right.promptSnippet, "en");
  });
}

export function sortShellMetasyntaxTelemetry(entries) {
  return [...entries].sort((left, right) => {
    const fileCmp = left.file.localeCompare(right.file, "en");
    if (fileCmp !== 0) return fileCmp;

    const nodeCmp = left.nodeId.localeCompare(right.nodeId, "en");
    if (nodeCmp !== 0) return nodeCmp;

    const tokenCmp = left.forbiddenToken.localeCompare(right.forbiddenToken, "en");
    if (tokenCmp !== 0) return tokenCmp;

    const lineCmp = left.line - right.line;
    if (lineCmp !== 0) return lineCmp;

    return left.promptSnippet.localeCompare(right.promptSnippet, "en");
  });
}
