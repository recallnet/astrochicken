import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { selectManagedIntakeIssue } from "../../src/commands/supervisor-managed-intake-selector.ts";

function makeGhJsonFn(issues = []) {
  const calls = [];
  return {
    fn: (args, fallback) => {
      calls.push(args);
      return issues;
    },
    calls,
  };
}

function makeDispatchableGoalGhJsonFn({
  issues = [],
  blockedByByGoal = {},
  subIssuesByGoal = {},
} = {}) {
  return (args, fallback) => {
    if (args[0] === "issue" && args[1] === "list") {
      return issues;
    }

    if (args[0] === "api" && args[1] === "graphql") {
      const queryArg = args.find((entry) => String(entry).startsWith("query=")) || "";
      const singleIssueMatch = String(queryArg).match(/issue\(number:(\d+)\)\s*\{\s*blockedBy/);
      if (singleIssueMatch) {
        const issueNumber = Number(singleIssueMatch[1]);
        return {
          data: {
            repository: {
              issue: {
                blockedBy: { nodes: blockedByByGoal[issueNumber] || [] },
              },
            },
          },
        };
      }
      const matches = [...String(queryArg).matchAll(/i(\d+):\s*issue\(number:(\d+)\)/g)];
      const repository = {};
      for (const match of matches) {
        const issueNumber = Number(match[2]);
        repository[`i${issueNumber}`] = {
          blockedBy: { nodes: blockedByByGoal[issueNumber] || [] },
        };
      }
      return { data: { repository } };
    }

    if (args[0] === "api" && String(args[1] || "").includes("/sub_issues?")) {
      const match = String(args[1] || "").match(/issues\/(\d+)\/sub_issues/);
      const goalNumber = Number(match?.[1] || 0);
      return subIssuesByGoal[goalNumber] || [];
    }

    return fallback;
  };
}

const VALID_REPO = "owner/repo";
const NOOP_GH = () => [];

function extractLabelArgs(args) {
  const labels = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--label") labels.push(args[i + 1]);
  }
  return labels;
}

function makeIssue({ number = 1, title = "Issue", body = "body", url = "", labels = [] } = {}) {
  return {
    number,
    title,
    body,
    url: url || `https://github.com/owner/repo/issues/${number}`,
    labels: labels.map((name) => ({ name })),
  };
}

describe("selectManagedIntakeIssue", () => {
  // --- Input validation ---

  describe("input validation", () => {
    it("missing repo returns missing_target_repo", () => {
      const result = selectManagedIntakeIssue({ ghJsonFn: NOOP_GH });
      assert.equal(result.has_issue, "false");
      assert.equal(result.selected_issue_number, "");
      assert.equal(result.parse_error, "missing_target_repo");
    });

    it("empty string repo returns missing_target_repo", () => {
      const result = selectManagedIntakeIssue({ repo: "  ", ghJsonFn: NOOP_GH });
      assert.equal(result.has_issue, "false");
      assert.equal(result.parse_error, "missing_target_repo");
    });

    it("invalid repo (no slash) returns invalid_target_repo", () => {
      const result = selectManagedIntakeIssue({ repo: "noslash", ghJsonFn: NOOP_GH });
      assert.equal(result.has_issue, "false");
      assert.equal(result.parse_error, "invalid_target_repo");
    });

    it("invalid intakeJson returns invalid_intake_json", () => {
      const result = selectManagedIntakeIssue({
        repo: VALID_REPO,
        intakeJson: "{not json",
        ghJsonFn: NOOP_GH,
      });
      assert.equal(result.has_issue, "false");
      assert.equal(result.parse_error, "invalid_intake_json");
    });

    it("intakeJson is array returns invalid_intake_json_object", () => {
      const result = selectManagedIntakeIssue({
        repo: VALID_REPO,
        intakeJson: "[]",
        ghJsonFn: NOOP_GH,
      });
      assert.equal(result.has_issue, "false");
      assert.equal(result.parse_error, "invalid_intake_json_object");
    });

    it("no labels (empty intake, empty labels) returns missing_issue_selector_labels", () => {
      const result = selectManagedIntakeIssue({
        repo: VALID_REPO,
        intakeJson: "{}",
        labels: [],
        ghJsonFn: NOOP_GH,
      });
      assert.equal(result.has_issue, "false");
      assert.equal(result.parse_error, "missing_issue_selector_labels");
    });

    it("invalid issue_selector (non-object) returns invalid_issue_selector", () => {
      const result = selectManagedIntakeIssue({
        repo: VALID_REPO,
        intakeJson: JSON.stringify({ issue_selector: "bad" }),
        labels: ["bug"],
        ghJsonFn: NOOP_GH,
      });
      assert.equal(result.has_issue, "false");
      assert.equal(result.parse_error, "invalid_issue_selector");
    });

    it("issue_selector as array returns invalid_issue_selector", () => {
      const result = selectManagedIntakeIssue({
        repo: VALID_REPO,
        intakeJson: JSON.stringify({ issue_selector: [1, 2] }),
        labels: ["bug"],
        ghJsonFn: NOOP_GH,
      });
      assert.equal(result.has_issue, "false");
      assert.equal(result.parse_error, "invalid_issue_selector");
    });
  });

  // --- Issue selection ---

  describe("issue selection", () => {
    it("one issue returned is selected", () => {
      const issue = makeIssue({ number: 42, title: "Fix bug", body: "description" });
      const stub = makeGhJsonFn([issue]);
      const result = selectManagedIntakeIssue({
        repo: VALID_REPO,
        labels: ["bug"],
        ghJsonFn: stub.fn,
      });
      assert.equal(result.has_issue, "true");
      assert.equal(result.selected_issue_number, "42");
      assert.equal(result.selected_issue_title, "Fix bug");
      assert.equal(result.selected_issue_body, "description");
      assert.equal(result.parse_error, "");
    });

    it("multiple issues selects lowest number", () => {
      const issues = [
        makeIssue({ number: 99, title: "Later" }),
        makeIssue({ number: 5, title: "First" }),
        makeIssue({ number: 50, title: "Middle" }),
      ];
      const stub = makeGhJsonFn(issues);
      const result = selectManagedIntakeIssue({
        repo: VALID_REPO,
        labels: ["bug"],
        ghJsonFn: stub.fn,
      });
      assert.equal(result.has_issue, "true");
      assert.equal(result.selected_issue_number, "5");
      assert.equal(result.selected_issue_title, "First");
      assert.equal(result.parse_error, "");
    });

    it("goal+ready intake skips blocked ready goals and selects the first dispatchable goal", () => {
      const issues = [
        makeIssue({ number: 1392, title: "Blocked Goal", body: "blocked", labels: ["goal", "ready"] }),
        makeIssue({ number: 1394, title: "Dispatchable Goal", body: "dispatchable", labels: ["goal", "ready"] }),
      ];
      const result = selectManagedIntakeIssue({
        repo: VALID_REPO,
        labels: ["goal", "ready"],
        ghJsonFn: makeDispatchableGoalGhJsonFn({
          issues,
          blockedByByGoal: {
            1392: [{ number: 1391, state: "OPEN" }],
            1394: [],
          },
          subIssuesByGoal: {
            1392: [],
            1394: [],
          },
        }),
      });

      assert.equal(result.has_issue, "true");
      assert.equal(result.selected_issue_number, "1394");
      assert.equal(result.selected_issue_title, "Dispatchable Goal");
      assert.equal(result.selected_issue_body, "dispatchable");
    });

    it("no issues returned yields has_issue false", () => {
      const stub = makeGhJsonFn([]);
      const result = selectManagedIntakeIssue({
        repo: VALID_REPO,
        labels: ["bug"],
        ghJsonFn: stub.fn,
      });
      assert.equal(result.has_issue, "false");
      assert.equal(result.selected_issue_number, "");
      assert.equal(result.parse_error, "");
    });

    it("issue with invalid number is filtered out", () => {
      const issues = [
        { number: "abc", title: "Bad", body: "", url: "" },
        makeIssue({ number: 10, title: "Good" }),
      ];
      const stub = makeGhJsonFn(issues);
      const result = selectManagedIntakeIssue({
        repo: VALID_REPO,
        labels: ["bug"],
        ghJsonFn: stub.fn,
      });
      assert.equal(result.has_issue, "true");
      assert.equal(result.selected_issue_number, "10");
    });

    it("malformed issue list (non-array) returns malformed_issue_list_payload", () => {
      const result = selectManagedIntakeIssue({
        repo: VALID_REPO,
        labels: ["bug"],
        ghJsonFn: () => "not-an-array",
      });
      assert.equal(result.parse_error, "malformed_issue_list_payload");
      assert.equal(result.has_issue, "false");
    });

    it("issue with zero number is filtered out", () => {
      const issues = [{ number: 0, title: "Zero", body: "", url: "" }];
      const stub = makeGhJsonFn(issues);
      const result = selectManagedIntakeIssue({
        repo: VALID_REPO,
        labels: ["bug"],
        ghJsonFn: stub.fn,
      });
      assert.equal(result.has_issue, "false");
      assert.equal(result.selected_issue_number, "");
    });

    it("issue with negative number is filtered out", () => {
      const issues = [{ number: -1, title: "Neg", body: "", url: "" }];
      const stub = makeGhJsonFn(issues);
      const result = selectManagedIntakeIssue({
        repo: VALID_REPO,
        labels: ["bug"],
        ghJsonFn: stub.fn,
      });
      assert.equal(result.has_issue, "false");
      assert.equal(result.selected_issue_number, "");
    });
  });

  // --- Label merging ---

  describe("label merging", () => {
    it("merges labels from intakeJson.issue_selector.labels with explicit labels", () => {
      const stub = makeGhJsonFn([]);
      selectManagedIntakeIssue({
        repo: VALID_REPO,
        intakeJson: JSON.stringify({ issue_selector: { labels: ["intake-label"] } }),
        labels: ["explicit-label"],
        ghJsonFn: stub.fn,
      });
      assert.equal(stub.calls.length, 1);
      const labelArgs = extractLabelArgs(stub.calls[0]);
      assert.ok(labelArgs.includes("intake-label"), "intake label present");
      assert.ok(labelArgs.includes("explicit-label"), "explicit label present");
    });

    it("deduplicates labels", () => {
      const stub = makeGhJsonFn([]);
      selectManagedIntakeIssue({
        repo: VALID_REPO,
        intakeJson: JSON.stringify({ issue_selector: { labels: ["bug", "dup"] } }),
        labels: ["bug", "dup"],
        ghJsonFn: stub.fn,
      });
      const labelArgs = extractLabelArgs(stub.calls[0]);
      assert.equal(labelArgs.length, 2, "deduplicated to 2 unique labels");
      assert.deepEqual([...new Set(labelArgs)].sort(), ["bug", "dup"]);
    });

    it("passes labels to ghJsonFn query args", () => {
      const stub = makeGhJsonFn([]);
      selectManagedIntakeIssue({
        repo: VALID_REPO,
        labels: ["enhancement"],
        ghJsonFn: stub.fn,
      });
      assert.equal(stub.calls.length, 1);
      const labelArgs = extractLabelArgs(stub.calls[0]);
      assert.ok(labelArgs.includes("enhancement"));
    });
  });

  // --- intake_json output ---

  describe("intake_json output", () => {
    it("contains expected fields on successful selection", () => {
      const issue = makeIssue({ number: 7, title: "T", body: "B", labels: ["bug"] });
      const stub = makeGhJsonFn([issue]);
      const result = selectManagedIntakeIssue({
        repo: VALID_REPO,
        labels: ["bug"],
        ghJsonFn: stub.fn,
      });
      const parsed = JSON.parse(result.intake_json);
      assert.equal(parsed.selector, "issue_list_first_open");
      assert.equal(parsed.target_repo, VALID_REPO);
      assert.deepEqual(parsed.issue_selector, { labels: ["bug"] });
      assert.equal(parsed.has_issue, true);
      assert.equal(parsed.issue.number, 7);
    });

    it("contains expected fields when no issue selected", () => {
      const stub = makeGhJsonFn([]);
      const result = selectManagedIntakeIssue({
        repo: VALID_REPO,
        labels: ["bug"],
        ghJsonFn: stub.fn,
      });
      const parsed = JSON.parse(result.intake_json);
      assert.equal(parsed.selector, "issue_list_first_open");
      assert.equal(parsed.target_repo, VALID_REPO);
      assert.equal(parsed.has_issue, false);
      assert.equal(parsed.issue, null);
    });

    it("failure result includes intake_json with reason", () => {
      const result = selectManagedIntakeIssue({
        repo: VALID_REPO,
        intakeJson: "{bad",
        ghJsonFn: NOOP_GH,
      });
      const parsed = JSON.parse(result.intake_json);
      assert.equal(parsed.has_issue, false);
      assert.equal(parsed.reason, "invalid_intake_json");
    });
  });

  // --- Edge cases ---

  describe("edge cases", () => {
    it("empty intakeJson is tolerated (labels from explicit param)", () => {
      const stub = makeGhJsonFn([]);
      const result = selectManagedIntakeIssue({
        repo: VALID_REPO,
        intakeJson: "",
        labels: ["ready"],
        ghJsonFn: stub.fn,
      });
      assert.equal(result.parse_error, "");
      assert.equal(result.has_issue, "false");
    });

    it("ghJsonFn returning null yields malformed_issue_list_payload", () => {
      const result = selectManagedIntakeIssue({
        repo: VALID_REPO,
        labels: ["bug"],
        ghJsonFn: () => null,
      });
      assert.equal(result.parse_error, "malformed_issue_list_payload");
    });

    it("issue labels normalized from objects with name field", () => {
      const issue = {
        number: 1,
        title: "T",
        body: "B",
        url: "",
        labels: [{ name: "bug" }, { name: "p1" }],
      };
      const stub = makeGhJsonFn([issue]);
      const result = selectManagedIntakeIssue({
        repo: VALID_REPO,
        labels: ["bug"],
        ghJsonFn: stub.fn,
      });
      const parsed = JSON.parse(result.intake_json);
      assert.deepEqual(parsed.issue.labels, ["bug", "p1"]);
    });

    it("invalid_issue_selector_labels when selector labels is non-array", () => {
      const result = selectManagedIntakeIssue({
        repo: VALID_REPO,
        intakeJson: JSON.stringify({ issue_selector: { labels: "not-array" } }),
        labels: ["bug"],
        ghJsonFn: NOOP_GH,
      });
      assert.equal(result.has_issue, "false");
      assert.equal(result.parse_error, "invalid_issue_selector_labels");
    });
  });
});
