// Each call returns a fresh domain fixture so individual tests can safely mutate it.

export function makeReusableGapAnalysis() {
  return {
      reusable_capability_gaps: [{ feature_id: "F-1", name: "Reusable capability" }],
      reusable_policy_profile_gaps: [{ feature_id: "F-2", name: "Reusable policy/profile" }],
      factory_instance_wiring: [],
      domain_specific_residues: [],
      raw_bucket_text: {
        reusable_capability_gaps: ["shared capability"],
        reusable_policy_profile_gaps: ["shared policy"],
        factory_instance_wiring: [],
        domain_specific_residues: [],
      },
      normalization_warnings: [],
    };
}

export function makeActiveMilestoneLeaseSnapshot() {
  return {
      active_leases: [{ run_id: "run-1", milestone_title: "S1" }],
      stale_candidates: [],
      active_milestones: ["S1"],
      active_lease_count: 1,
      stale_candidate_count: 0,
    };
}

export function makeReleaseSlackAndIssueDecision() {
  return {
      delivery_decision: "slack_and_issue",
      headline: "Managed factories now keep release chatter quiet",
      before_state: "Low-signal release windows still interrupted people.",
      after_state: "The reporter now keeps weaker windows in GitHub without broadcasting them to Slack.",
      summary: "The release reporter now skips trivial merge trickles and writes fuller briefs, so real conceptual changes get durable narration.",
      conceptual_shift: "Understanding is now the release unit, not merge-level narration.",
      why_it_matters: "The team sees fewer interruptions and better catch-up material.",
      proof_points: ["Issue-heavy release windows can still produce durable reports."],
      structural_changes: ["Publish flow now expects deterministic significance context in the narrative contract."],
      behavioral_shifts: ["Issue-only windows still include comprehension sections when narrating."],
      implicit_decisions: ["Issue-only delivery remains non-blocking and signal-first."],
      entry_points: ["packages/factory-ops/src/commands/release-publish-report.ts"],
      watch_items: [],
    };
}

export function makeSkillContractRequirements() {
  return {
      required_top_level_keys: ["name", "version", "description", "output_schema", "tools", "safety"],
      required_tool_keys: ["allowed", "forbidden"],
      required_safety_keys: [
        "may_modify_tests",
        "may_create_files",
        "may_delete_files",
        "may_run_destructive_commands",
      ],
    };
}

export function makePrerequisiteGoalA() {
  return {
          goal_id: "prereq_a",
          goal_kind: "prerequisite",
          title: "Prerequisite A",
          issue_set_id: "set_prereq_a",
        };
}

export function makeCreatedTradingSubIssue() {
  return {
        issue_number: "3001",
        parent_issue_number: "3000",
        repo: "example-org/example-trading",
        created: true,
        sub_issue_link_status: "linked",
        merge_status: "pushed",
        shipped_to_main: true,
        github_close_status: "",
        last_error: "",
      };
}

export function makeCompletedGoal1789Summary() {
  return {
      goal_number: "1789",
      total_sub_issue_count: 2,
      closed_sub_issue_numbers: ["1791", "1792"],
      open_sub_issue_numbers: [],
      has_sub_issues: true,
      any_open_sub_issues: false,
      goal_close_status: "closed",
      goal_close_reason: "completed",
    };
}

export function makeAppliedTradingSubIssueLinkEvent() {
  return {
        event_family: "factory.issue.sub_issue_link_applied",
        payload: {
          issue_number: "1791",
          parent_issue_number: "1789",
          repo: "example-org/example-trading",
          link_status: "linked",
          error: "",
        },
      };
}

export function makeFinalInstantiationGoal() {
  return {
        goal_id: "final_inst",
        goal_kind: "final_instantiation",
        title: "Final instantiation",
        issue_set_id: "set_final",
      };
}

export function makeInstalledHostCapacity() {
  return {
      hostId: "host-a",
      status: "installed",
      installationCount: 3,
      host_active_slots: 2,
      host_max_active_slots: 4,
      host_capacity_pressure: 0.5,
      host_pending_installations: 1,
    };
}

export function makeSandboxCredentialBlocker() {
  return {
    kind: "missing_credentials",
    exact_request: "Provide sandbox API key",
    why_blocked: "Factory cannot derive the credential",
    unblock_condition: "Credential location is provided",
  };
}

export function makeCapabilitySourceFeature() {
  return {
        feature_id: "F-cap",
        source_feature: {
          feature_id: "F-cap",
          issue_set_id: "set_capability",
          goal_id: "goal_capability",
        },
      };
}

export function makeEmptyLensCollection() {
  return {
    base: {
      langfuse: { meta: {} },
      github: { meta: {} },
      git: { meta: {} },
      hatch_runs: { meta: {} },
      supervisor: { meta: {} },
    },
  };
}

export function makeLensFollowupContext() {
  return {
      repo: "recallnet/astrochicken",
      factory_id: "mothership",
      generated_at: "2026-03-17T18:00:00.000Z",
      since_iso: "2026-03-17T15:00:00.000Z",
      metrics: { goals_closed: 1, issues_closed: 3, commits_landed: 4 },
      goals: [],
    };
}

export function makeExternalArtifactFeedbackContext() {
  return {
    controlPlaneRepo: "recallnet/astrochicken",
    sourceRepo: "example/external-factory",
    sourceIssueNumber: 10,
    signature: "sha256:abc",
    goalNumber: 500,
    factoryId: "external/issue_worker",
    requiredFactoryRelease: "1.2.3",
  };
}

export function makeUnblockedIssueGraphqlResponse() {
  return {
          data: {
            repository: {
              i: {
                blockedBy: {
                  nodes: [],
                },
              },
            },
          },
        };
}

export const acquireReleaseLeaseFixture = ({ trackingIssueNumber, factoryId, leaseName, runId, holderId }) => ({
      ok: true,
      acquired: true,
      reason: "lease_acquired",
      tracking_issue_number: trackingIssueNumber,
      factory_id: factoryId,
      lease_name: leaseName,
      run_id: runId,
      holder_id: holderId,
      lease: { expires_at: "2026-03-07T01:00:00.000Z" },
      comment_id: 1,
      comment_etag: '"1"',
    });

export function createReleaseIssueReader(fixture) {
  return (args, fallback = []) => {
    if (args[0] === "issue" && args[1] === "list") {
      const repo = args[args.indexOf("--repo") + 1];
      const state = args[args.indexOf("--state") + 1];
      return fixture.issue_list?.[repo]?.[state] || [];
    }
    if (args[0] === "issue" && args[1] === "view") {
      const issueNumber = String(args[2]);
      const repo = args[args.indexOf("--repo") + 1];
      return fixture.issue_view?.[repo]?.[issueNumber] || { number: Number(issueNumber), comments: [], url: "" };
    }
    return fallback;
  };
}

export const readLensReport2188 = (args) => {
      if (args[0] === "issue" && args[1] === "view" && String(args[2]) === "2188") {
        return {
          number: 2188,
          url: "https://github.com/recallnet/astrochicken/issues/2188",
          title: "Daily Lens Report — 2026-03-16",
          body: "Report body",
        };
      }
      return {};
    };

export function createLensFollowupIssueReader(existingBody) {
  return (args) => {
      if (args[0] === "issue" && args[1] === "view" && String(args[2]) === "2205") {
        return {
          number: 2205,
          url: "https://github.com/recallnet/astrochicken/issues/2205",
          title: "Daily Lens follow-up",
          body: existingBody,
        };
      }
      if (args[0] === "issue" && args[1] === "view" && String(args[2]) === "2188") {
        return {
          number: 2188,
          url: "https://github.com/recallnet/astrochicken/issues/2188",
          title: "Daily Lens Report — 2026-03-16",
          body: "report body",
        };
      }
      return {};
    };
}

export function createSuccessfulSlackFetch(calls) {
  return async (url) => {
      calls.push(url);
      return {
        ok: true,
        status: 200,
        text: async () => "ok",
      };
    };
}

export function createMemoryFileReader(files) {
  return async (targetPath) => {
    if (!files.has(targetPath)) {
      const error = new Error("missing");
      error.code = "ENOENT";
      throw error;
    }
    return files.get(targetPath);
  };
}

export const linkSubIssueSuccessfully = ({ parentNumber, childNumber }) => ({
          ok: true,
          parent: String(parentNumber),
          child: String(childNumber),
          error: "",
          status: 0,
          stderr: "",
        });

export const reconcileNoLensCandidates = async () => ({
      ok: true,
      created_count: 0,
      updated_count: 0,
      reused_count: 0,
      reconciled_count: 0,
      candidates: [],
    });
