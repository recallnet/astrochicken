import { runScheduledGraph } from "./daemon-scheduled-graph-runner.ts";
import {
  evaluateScheduledJob,
  formatScheduledJobLocalDate,
  readScheduledJobsState,
  resolveScheduledJobs,
  writeScheduledJobsState,
} from "./daemon-schedules.ts";

function trim(value = "") {
  return String(value ?? "").trim();
}

function resolveFailureCode(error, fallback = "job_failed") {
  return trim(error?.code || "") || fallback;
}

const DAILY_LENS_SCHEDULED_GRAPH_PATH = "factories/mothership/graphs/daily_lens_publish.dot";

function resolveScheduledGraphJob(job = {}) {
  const jobId = trim(job?.id);
  const jobType = trim(job?.type);
  if (jobType === "graph") return { ...job };
  if (jobId === "daily-lens" && jobType === "analysis.publish_lens") {
    const graph = trim(job?.graph || DAILY_LENS_SCHEDULED_GRAPH_PATH) || DAILY_LENS_SCHEDULED_GRAPH_PATH;
    return {
      ...job,
      type: "graph",
      graph,
    };
  }
  return null;
}

function resolveScheduledJobContext({
  job = {},
  runtime = {},
  evaluation = {},
} = {}) {
  const scheduledLocalDate = formatScheduledJobLocalDate({
    scheduledAt: evaluation.scheduled_at,
    timeZone: trim(job.time_zone || "UTC") || "UTC",
  });
  const scheduledAt = new Date(evaluation.scheduled_at);
  const trailingHours = Math.max(1, Number(job.report_window_hours || 24));
  const windowEnd = scheduledAt.toISOString();
  const windowStart = new Date(scheduledAt.getTime() - (trailingHours * 60 * 60 * 1000)).toISOString();
  const repo = trim(job.repo || runtime.controlPlaneRepo || runtime.targetRepo);

  return {
    date: scheduledLocalDate,
    repo,
    gh_repo: repo,
    factory_id: trim(runtime.factoryId || ""),
    target_repo: trim(runtime.targetRepo || ""),
    control_plane_repo: trim(runtime.controlPlaneRepo || runtime.targetRepo || ""),
    scheduled_job_id: trim(job.id),
    scheduled_job_type: trim(job.type),
    scheduled_at: evaluation.scheduled_at,
    scheduled_local_date: scheduledLocalDate,
    report_window_hours: String(trailingHours),
    window_start: windowStart,
    window_end: windowEnd,
    output_dir: trim(job.output_dir || "reports/lens"),
    notify_slack: job.notify_slack === true ? "true" : "false",
    issue_labels_json: JSON.stringify(Array.isArray(job.issue_labels) ? job.issue_labels : ["daily-lens"]),
    runs_dir: trim(runtime.runsDir || ""),
    repo_path: trim(runtime.contextRepoPath || ""),
  };
}

export async function runScheduledJobs({
  runtime = {},
  paths = {},
  repoRoot = "",
  hostBaseDir = "",
  activeChildRef = { current: null },
  now = new Date(),
  daemonLogPath = "",
  appendLogLineFn,
  runScheduledGraphFn = runScheduledGraph,
} = {}) {
  const logFn = typeof appendLogLineFn === "function" ? appendLogLineFn : () => {};
  const jobs = resolveScheduledJobs(runtime?.config);
  if (jobs.length === 0) return { executed: [], due_count: 0 };

  const state = readScheduledJobsState(paths.scheduledJobsStatePath);
  const nextState = {
    ...state,
    jobs: { ...(state?.jobs && typeof state.jobs === "object" ? state.jobs : {}) },
  };
  const executed = [];

  for (const job of jobs) {
    const jobId = trim(job.id);
    const currentState = nextState.jobs[jobId] || {};
    const evaluation = evaluateScheduledJob({ job, state: currentState, now });

    logFn(
      daemonLogPath,
      `schedule_check job=${jobId} due=${evaluation.due} reason=${evaluation.reason} scheduled_at=${evaluation.scheduled_at || "none"}`,
    );

    if (!evaluation.due) continue;

    nextState.jobs[jobId] = {
      ...currentState,
      last_scheduled_at: evaluation.scheduled_at,
      last_started_at: new Date(now).toISOString(),
      last_status: "running",
    };
    writeScheduledJobsState(paths.scheduledJobsStatePath, nextState);

    try {
      const graphJob = resolveScheduledGraphJob(job);
      if (graphJob) {
        const result = await runScheduledGraphFn({
          runtime,
          job: graphJob,
          context: resolveScheduledJobContext({ job: graphJob, runtime, evaluation }),
          paths,
          repoRoot,
          hostBaseDir,
          activeChildRef,
          daemonLogPath,
          appendLogLineFn: logFn,
        });
        const runId = trim(result?.runId || "");
        const issueUrl = trim(result?.context?.scheduled_job_issue_url || result?.context?.issue_url || "");
        const exitCode = Number(result?.exitCode ?? 0);

        if (exitCode === 0) {
          nextState.jobs[jobId] = {
            ...nextState.jobs[jobId],
            last_completed_at: new Date().toISOString(),
            last_status: "ok",
            last_issue_url: issueUrl,
            last_run_id: runId,
          };
          executed.push({
            id: jobId,
            type: trim(job.type),
            scheduled_at: evaluation.scheduled_at,
            status: "ok",
            issue_url: issueUrl,
            run_id: runId,
          });
          logFn(daemonLogPath, `schedule_job_complete job=${jobId} type=${trim(job.type)} run_id=${runId || "unknown"} issue=${issueUrl || "none"}`);
        } else {
          const failureSuffix = Number.isFinite(exitCode) ? String(exitCode) : "unknown";
          const errorCode = `scheduled_graph_exit_${failureSuffix}`;
          const errorMessage = `Graph run exited with code ${failureSuffix}`;
          nextState.jobs[jobId] = {
            ...nextState.jobs[jobId],
            last_failed_at: new Date().toISOString(),
            last_status: "failed",
            last_error_code: errorCode,
            last_error: errorMessage,
            last_run_id: runId,
          };
          executed.push({
            id: jobId,
            type: trim(job.type),
            scheduled_at: evaluation.scheduled_at,
            status: "failed",
            error_code: errorCode,
            error: errorMessage,
            run_id: runId,
          });
          logFn(
            daemonLogPath,
            `schedule_job_failed job=${jobId} type=${trim(job.type)} run_id=${runId || "unknown"} error_code=${errorCode} exit_code=${failureSuffix} error=${errorMessage}`,
          );
        }
      } else {
        nextState.jobs[jobId] = {
          ...nextState.jobs[jobId],
          last_completed_at: new Date().toISOString(),
          last_status: "skipped_unknown_type",
        };
        executed.push({ id: jobId, type: trim(job.type), scheduled_at: evaluation.scheduled_at, status: "skipped_unknown_type" });
      }
    } catch (error) {
      const errorMessage = String(error?.message || error);
      const errorCode = resolveFailureCode(error, "job_failed");
      nextState.jobs[jobId] = {
        ...nextState.jobs[jobId],
        last_failed_at: new Date().toISOString(),
        last_status: "failed",
        last_error_code: errorCode,
        last_error: errorMessage,
      };
      executed.push({
        id: jobId,
        type: trim(job.type),
        scheduled_at: evaluation.scheduled_at,
        status: "failed",
        error_code: errorCode,
        error: errorMessage,
      });
      logFn(daemonLogPath, `schedule_job_failed job=${jobId} type=${trim(job.type)} error_code=${errorCode} error=${errorMessage}`);
    }

    writeScheduledJobsState(paths.scheduledJobsStatePath, nextState);
  }

  return { executed, due_count: executed.length };
}
