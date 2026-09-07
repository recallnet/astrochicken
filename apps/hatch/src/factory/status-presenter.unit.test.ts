import { describe, expect, it } from "vitest";

import {
	formatFactoryContextHeaderLines,
	formatControlPlaneGateSection,
	formatManagedStateLine,
	formatRuntimeDriftSection,
	formatActiveRunTreeRows,
	formatTickStageLine,
	presentFactoryStatus,
	presentFactoryActiveSummary,
	presentTickStatus,
	renderFactoryPresentation,
} from "./status-presenter.js";

describe("factory status presenter", () => {
	it("formats canonical section helpers", () => {
		expect(formatFactoryContextHeaderLines({ factory_id: "mothership", target_repo: "recallnet/astrochicken", factory_mode: "standalone" }).join("\n")).toContain("Factory ID: mothership");
	expect(formatFactoryContextHeaderLines({ factory_id: "mothership", target_repo: "recallnet/astrochicken", factory_mode: "managed" }).join("\n")).toContain("Factory Mode: managed");
		expect(formatFactoryContextHeaderLines({ factory_id: "mothership", target_repo: "recallnet/astrochicken" }).join("\n")).toContain("Factory Mode: standalone");
		expect(formatControlPlaneGateSection({ selected_channel: "canary", resume_reason: "release_not_promoted_to_general", can_resume: false }).join("\n")).toContain("channel=canary");
		expect(formatManagedStateLine({ state_action: "pause", health_classification: "operator_paused" }).join("\n")).toContain("action=pause");
		expect(formatRuntimeDriftSection({
			runtime_version: "0.9.0",
			kind_version: "mothership",
			rollout_channel: "stable",
			rollout_status: "lagging",
			upgrade_verification_outcome: "failed",
			drift_state: "lagging",
			gate_reason: "factory_release_below_required",
		}).join("\n")).toContain("Runtime version: 0.9.0");
		expect(formatTickStageLine({ stageLabel: "Executing wave", progress: "[2/21]" })).toBe("  Stage: Executing wave  [2/21]");
		const tree = formatActiveRunTreeRows([
			{ id: "run-parent", node: "wave_execute", graph: "factory_supervisor_tick.dot", children: [{ runId: "run-child" }] },
			{ id: "run-child", node: "build", graph: "goal_execute.dot", goal_execution_path: "easy", goal_execution_mode: "direct", children: [] },
		]).join("\n");
		expect(tree).toContain("run-pare");
		expect(tree).toContain("run-chil");
		expect(tree).toContain("goal_execution_path=easy (direct)");
		expect(tree).toContain("goal_execution_path_version=unknown");
	});

	it("labels running/latest tick sections as CURRENT + LAST with deterministic older tick labels", () => {
		const tick = {
			context: { factory_id: "mothership", target_repo: "recallnet/astrochicken" },
			ticks: [{
				id: "tick-running",
				status: "running",
				stage: "wave_execute",
				stageLabel: "Executing wave",
				progress: "[12/23]",
				startedAt: "2026-01-01T00:01:00.000Z",
				elapsed: "2m10s",
				goalCount: "2",
				blocked_control_plane: [],
			}, {
				id: "tick-last",
				status: "completed",
				stage: "done",
				stageLabel: "Done",
				progress: "[23/23]",
				startedAt: "2026-01-01T00:00:00.000Z",
				elapsed: "45s",
				goalCount: "",
				blocked_control_plane: [],
			}, {
				id: "tick-older",
				status: "failed",
				stage: "review",
				stageLabel: "Review",
				progress: "[18/23]",
				startedAt: "2025-12-31T23:58:00.000Z",
				elapsed: "5m",
				goalCount: "",
				blocked_control_plane: [],
			}],
		};

		const rendered = renderFactoryPresentation(presentTickStatus(tick));
		expect(rendered).toContain("CURRENT TICK  >>>  tick-running");
		expect(rendered).toContain("LAST TICK  OK  tick-last");
		expect(rendered).toContain("TICK -2  FAIL  tick-older");
	});

	it("renders multiple active children for fan-out ticks", () => {
		const rendered = renderFactoryPresentation(presentTickStatus({
			context: { factory_id: "mothership", target_repo: "recallnet/astrochicken" },
			ticks: [{
				id: "tick-running",
				status: "running",
				stage: "fan_out_goal_run",
				stageLabel: "Run goals in parallel",
				progress: "[9/28]",
				startedAt: "2026-03-11T20:38:56.053Z",
				elapsed: "1m13s",
				goalCount: "2",
				children: [{
					runId: "cdea906e",
					node: "intake_decompose",
					issue: "1812",
					goal_execution_path: "hard",
					goal_execution_path_version: "routing/v1",
					planning_state: "pending_review",
					child: {
						runId: "5fb96856",
						node: "analyze",
						issue: "1812",
						goal_execution_path: "hard",
						goal_execution_path_version: "routing/v1",
						planning_state: "pending_review",
					},
				}, {
					runId: "4252df2e",
					node: "intake_decompose",
					issue: "1852",
					goal_execution_path: "hard",
					goal_execution_path_version: "routing/v1",
					planning_state: "approved",
					child: {
						runId: "d1e3dff4",
						node: "analyze",
						issue: "1852",
						goal_execution_path: "hard",
						goal_execution_path_version: "routing/v1",
						planning_state: "approved",
					},
				}],
				blocked_control_plane: [],
			}],
		}));

		expect(rendered).toContain("Active children: 2");
		expect(rendered).toContain("- cdea906e  node=intake_decompose #1812  goal_execution_path=hard  goal_execution_path_version=routing/v1  planning_state=pending_review");
		expect(rendered).toContain("└─ 5fb96856  node=analyze #1812  goal_execution_path=hard  goal_execution_path_version=routing/v1  planning_state=pending_review");
		expect(rendered).toContain("- 4252df2e  node=intake_decompose #1852  goal_execution_path=hard  goal_execution_path_version=routing/v1  planning_state=approved");
		expect(rendered).toContain("└─ d1e3dff4  node=analyze #1852  goal_execution_path=hard  goal_execution_path_version=routing/v1  planning_state=approved");
	});

	it("derives hard provisional label from routing state when provisional flag is missing", () => {
		const summaryPresentation = presentFactoryActiveSummary({
			context: { factory_id: "mothership", target_repo: "recallnet/astrochicken" },
			active_run_count: 1,
			active_wave_count: 1,
			managed_state: { state_action: "none", health_classification: "healthy" },
			control_plane: { selected_channel: "general", resume_reason: "ready_to_resume", can_resume: true },
			blocked_control_plane: [],
			waves: [{
				milestone_title: "goal-2300-wave-1",
				wave_issue_number: 2301,
				current_issue_number: 2302,
				completed_issues: 0,
				total_issues: 1,
				current_issue_node: "build",
				goal_execution_path: "hard",
				goal_execution_path_version: "routing/v1",
				goal_routing_state: {
					decomposition_state: "required",
					planning_state: "not_required",
				},
				trace_available: false,
			}],
			non_wave_active: [{
				run_id: "goal-run-2300",
				graph_label: "goal_execute.dot",
				node: "execute_issue",
				issue_number: 2300,
				age: "12s",
				goal_execution_path: "hard",
				goal_execution_path_version: "routing/v1",
				goal_routing_state: {
					decomposition_state: "required",
					planning_state: "not_required",
				},
				trace_available: false,
			}],
		});

		const rendered = renderFactoryPresentation(summaryPresentation);
		expect(rendered).toContain("goal_execution_path=hard (provisional)");
	});

	it("renders planning_state hold labels for hard-path review gating", () => {
		const rendered = renderFactoryPresentation(presentFactoryActiveSummary({
			context: { factory_id: "mothership", target_repo: "recallnet/astrochicken" },
			active_run_count: 1,
			active_wave_count: 1,
			managed_state: { state_action: "none", health_classification: "healthy" },
			control_plane: { selected_channel: "general", resume_reason: "ready_to_resume", can_resume: true },
			blocked_control_plane: [],
			waves: [{
				milestone_title: "goal-2332-wave-1",
				wave_issue_number: 2333,
				current_issue_number: 2332,
				completed_issues: 0,
				total_issues: 1,
				current_issue_node: "goal_run",
				goal_execution_path: "hard",
				goal_execution_path_version: "routing/v1",
				planning_state: "pending_review",
				goal_routing_state: {
					decomposition_state: "required",
					planning_state: "pending_review",
				},
				trace_available: false,
			}],
			non_wave_active: [{
				run_id: "goal-run-2332",
				graph_label: "goal_run.dot",
				node: "admission_check",
				issue_number: 2332,
				age: "7s",
				goal_execution_path: "hard",
				goal_execution_path_version: "routing/v1",
				planning_state: "approved",
				goal_routing_state: {
					decomposition_state: "required",
					planning_state: "approved",
				},
				trace_available: false,
			}],
		}));

		expect(rendered).toContain("planning_state=pending_review");
		expect(rendered).toContain("planning_state=approved");
	});

	it("returns presentation text + canonical json payload", () => {
		const status = {
			context: { factory_id: "mothership", target_repo: "recallnet/astrochicken" },
			active: [{ id: "run-1", node: "wave_execute", graph: "factory_supervisor_tick.dot", children: [] }],
			completed: 1,
			failed: 0,
			managed_state: { state_action: "none", health_classification: "healthy" },
			control_plane: { selected_channel: "general", resume_reason: "ready_to_resume", can_resume: true },
			blocked_control_plane: [],
			runtime_version: "0.9.0",
			kind_version: "mothership",
			rollout_channel: "stable",
			rollout_status: "ready",
			upgrade_verification_outcome: "passed",
			drift_state: "ready",
			gate_reason: "ready_to_resume",
		};
		const summary = {
			context: status.context,
			active_run_count: 1,
			active_wave_count: 1,
			managed_state: status.managed_state,
			control_plane: status.control_plane,
			blocked_control_plane: [],
			runtime_version: "0.9.0",
			kind_version: "mothership",
			rollout_channel: "stable",
			rollout_status: "ready",
			upgrade_verification_outcome: "passed",
			drift_state: "ready",
			gate_reason: "ready_to_resume",
			waves: [{
				milestone_title: "goal-1565-wave-2",
				wave_issue_number: 1630,
				current_issue_number: 1631,
				completed_issues: 1,
				total_issues: 2,
				current_issue_node: "review",
				goal_execution_path: "medium",
				goal_execution_path_version: "routing/v1",
				trace_available: false,
			}, {
				milestone_title: "goal-1567-provisional-hard",
				wave_issue_number: 1633,
				current_issue_number: 1634,
				completed_issues: 0,
				total_issues: 1,
				current_issue_node: "triage",
				goal_execution_path: "hard",
				goal_execution_path_version: "routing/v1",
				goal_routing_state: {
					decomposition_state: "required",
					planning_state: "not_required",
				},
				trace_available: false,
			}, {
				milestone_title: "goal-1566-easy-direct",
				wave_issue_number: 1632,
				current_issue_number: 1566,
				completed_issues: 0,
				total_issues: 0,
				current_issue_node: "goal_execute",
				goal_execution_path: "easy",
				goal_execution_mode: "direct",
				is_direct_goal_execution: true,
				goal_execution_path_version: "routing/v1",
				trace_available: false,
			}],
			non_wave_active: [{
				run_id: "goal-run-1",
				graph_label: "goal_execute.dot",
				node: "execute_issue",
				issue_number: 1565,
				age: "19s",
				goal_execution_path: "hard",
				goal_execution_path_version: "routing/v1",
				provisional_hard: true,
				trace_available: false,
			}],
		};
		const tick = {
			context: status.context,
			ticks: [{
				id: "tick-1",
				status: "running",
				stage: "wave_execute",
				stageLabel: "Executing wave",
				progress: "[2/21]",
				startedAt: "2026-01-01T00:00:00.000Z",
				elapsed: "30s",
				goalCount: "1",
				blocked_control_plane: [],
			}],
		};

		const statusPresentation = presentFactoryStatus(status);
		const summaryPresentation = presentFactoryActiveSummary(summary);
		const tickPresentation = presentTickStatus(tick);

		expect(statusPresentation.json).toBe(status);
		expect(summaryPresentation.json).toBe(summary);
		expect(tickPresentation.json).toBe(tick);
		expect(renderFactoryPresentation(statusPresentation)).toContain("Control plane gate:");
		expect(renderFactoryPresentation(statusPresentation)).toContain("Runtime drift:");
		expect(renderFactoryPresentation(summaryPresentation)).toContain("Active waves: 1");
		expect(renderFactoryPresentation(summaryPresentation)).toContain("goal_execution_path=medium");
		expect(renderFactoryPresentation(summaryPresentation)).toContain("goal_execution_path=hard (provisional)");
		expect(renderFactoryPresentation(summaryPresentation)).toContain("goal_execution_path=easy (direct)");
		expect(renderFactoryPresentation(summaryPresentation)).toContain("goal_execution_path_version=routing/v1");
		expect(renderFactoryPresentation(summaryPresentation)).toContain("Runtime version: 0.9.0");
		expect(renderFactoryPresentation(tickPresentation)).toContain("CURRENT TICK");
	});
});
