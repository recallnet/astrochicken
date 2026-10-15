import { randomUUID } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
	EventBus,
	flushOtelRuntime,
	shutdownOtelRuntime,
	type Event,
} from "@recallnet/factory-telemetry";

import { Context } from "../pipeline/context.js";
import { Engine, HandlerRegistry, type HandlerRegistry as HandlerRegistryLike } from "../pipeline/engine.js";
import { graphIdentityMode, type Graph } from "../pipeline/graph.js";
import { registerAll } from "../pipeline/handler/register.js";
import { persistLifecycleContextFromEngine } from "../pipeline/lifecycle-persistence.js";
import { parse } from "../pipeline/parse.js";
import { createReactorInstrumentationHelpers } from "../pipeline/reactor-instrumentation.js";
import { setLifecycleProjectionEmitter } from "../pipeline/run.js";
import {
	validate,
	formatValidationError,
	hasValidationErrors,
	isValidationMode,
	VALIDATION_MODES,
	type ValidationMode,
} from "../pipeline/validate.js";
import { createIssueList } from "@hatch/factory-core/schema-registry";

import type { HandlerConfig } from "../pipeline/handler/register.js";
import { HATCH_SERVER_OPENAPI_SURFACE } from "./openapi-contract.js";

interface PipelineRun {
	id: string;
	name: string;
	status: "created" | "running" | "completed" | "failed";
	graph?: Graph;
	events: Event[];
}

interface ServerRegistryBuilder {
	buildRegistry(args: {
		eventBus: EventBus;
		onSessionTelemetryEvent?: (event: {
			timestamp?: Date;
			runId?: string;
			handlerType: string;
			nodeId: string;
			sessionId: string;
			eventType: string;
			toolName?: string;
			message?: string;
			factoryContext?: Record<string, string>;
		}) => void;
	}): Promise<HandlerRegistryLike> | HandlerRegistryLike;
}

function isServerRegistryBuilder(value: HandlerRegistryLike | ServerRegistryBuilder): value is ServerRegistryBuilder {
	return "buildRegistry" in value && typeof value.buildRegistry === "function";
}

const createPipelineOperation = HATCH_SERVER_OPENAPI_SURFACE.operations.find((operation) => operation.operationId === "createPipeline");
const createPipelineRequestSchema = createPipelineOperation?.requestBody?.schema;

if (!createPipelineRequestSchema) {
	throw new Error("hatch_server_openapi_missing_create_pipeline_request_schema");
}

function parseCreatePipelineRequest(body: string) {
	return createPipelineRequestSchema.safeParse(JSON.parse(body));
}

function formatCreatePipelineIssues(error: any) {
	return createIssueList(error, (_issue, path) => ({
		path,
		message: path === "validation_mode" ? "invalid validation_mode" : "invalid value",
	}));
}

export function createServer(registry: HandlerRegistryLike | ServerRegistryBuilder, addr: string, handlerConfig?: HandlerConfig): Server {
	const pipelines = new Map<string, PipelineRun>();

	const server = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
		let url: URL;
		try {
			url = new URL(req.url ?? "/", `http://${req.headers.host}`);
		} catch {
			sendJSON(res, 400, { error: "invalid request URL or Host" });
			return;
		}
		// @context:security Reject DNS rebinding before reads as well as writes.
		if ((host === "127.0.0.1" || host === "localhost") && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
			sendJSON(res, 403, { error: "unrecognized local server hostname" });
			return;
		}

		if (url.pathname === "/health" && req.method === "GET") {
			sendJSON(res, 200, { status: "ok" });
			return;
		}

		if (url.pathname === "/pipelines" && req.method === "POST") {
			// @context:security Browser origins must not turn the local command
			// runner into a cross-site execution endpoint. CLI clients omit Origin.
			if (req.headers.origin && req.headers.origin !== url.origin) {
				sendJSON(res, 403, { error: "cross-origin pipeline submission forbidden" });
				return;
			}
			if (req.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
				sendJSON(res, 415, { error: "application/json required" });
				return;
			}
			const body = await readBody(req);

			try {
				const request = parseCreatePipelineRequest(body);
				if (!request.success) {
					const issues = formatCreatePipelineIssues(request.error);
					sendJSON(res, 400, {
						error: `invalid request payload:\n${issues.map((issue) => `${issue.path || "<root>"} ${issue.message}`).join("\n")}`,
					});
					return;
				}

				const parsed = request.data;

				let validationMode: ValidationMode | undefined;
				if (parsed.validation_mode !== undefined) {
					if (typeof parsed.validation_mode !== "string" || !isValidationMode(parsed.validation_mode)) {
						sendJSON(res, 400, {
							error: `invalid validation_mode "${String(parsed.validation_mode)}" (expected: ${VALIDATION_MODES.join(", ")})`,
						});
						return;
					}
					validationMode = parsed.validation_mode;
				}

				let graph: Graph;
				try {
					graph = parse(parsed.dot);
				} catch (err) {
					sendJSON(res, 400, { error: `parse error: ${err instanceof Error ? err.message : err}` });
					return;
				}

				const effectiveIdentityMode = validationMode ?? graphIdentityMode(graph);
				const errs = validate(graph, { identityMode: effectiveIdentityMode });
				if (hasValidationErrors(errs)) {
					sendJSON(res, 400, {
						error: "validation errors:\n" + errs.map(formatValidationError).join("\n"),
					});
					return;
				}

				const id = randomUUID();
				const run: PipelineRun = {
					id,
					name: graph.name,
					status: "created",
					graph,
					events: [],
				};
				pipelines.set(id, run);

				// Start execution in background
				executePipeline(run, registry, parsed.context, handlerConfig);

				sendJSON(res, 201, { id, status: "created" });
				return;
			} catch {
				sendJSON(res, 400, { error: "invalid JSON" });
				return;
			}
		}

		if (url.pathname.startsWith("/pipelines/") && req.method === "GET") {
			const id = url.pathname.slice("/pipelines/".length);
			const run = pipelines.get(id);
			if (!run) {
				sendJSON(res, 404, { error: "not found" });
				return;
			}
			sendJSON(res, 200, run);
			return;
		}

		sendJSON(res, 404, { error: "not found" });
	});

	// Parse addr like ":8080" or "localhost:8080"
	// @context:security Hostless addresses must stay local: this privileged API has no authentication.
	let host = "127.0.0.1";
	let port = 8080;
	if (addr.startsWith(":")) {
		port = parseInt(addr.slice(1), 10);
	} else if (addr.includes(":")) {
		const parts = addr.split(":");
		host = parts[0];
		port = parseInt(parts[1], 10);
	}

	server.listen(port, host, () => {
		console.log(`hatch server listening on ${addr}`);
	});

	return server;
}

async function executePipeline(
	run: PipelineRun,
	registry: HandlerRegistryLike | ServerRegistryBuilder,
	initialCtx?: Record<string, string>,
	handlerConfig?: HandlerConfig,
): Promise<void> {
	run.status = "running";

	const ctx = new Context(initialCtx);
	ctx.set("__run_id", run.id);
	if (handlerConfig?.modelPolicy) {
		ctx.set("model_policy_version", handlerConfig.modelPolicy.policySource.policyVersion);
		ctx.set("model_policy_source", handlerConfig.modelPolicy.policySource.configPath);
		ctx.set("model_policy_policy_pack_dir", handlerConfig.modelPolicy.policySource.policyPackDir);
		ctx.set("model_policy_default_provider", handlerConfig.modelPolicy.defaultProvider);
		ctx.set("model_policy_default_model", handlerConfig.modelPolicy.defaultModel);
		ctx.set("model_policy_selected_via", handlerConfig.modelPolicy.selectedVia);
		ctx.set("model_policy_allowed_models", handlerConfig.modelPolicy.allowedModels.join(","));
	}
	const bus = new EventBus();
	const reactorInstrumentation = createReactorInstrumentationHelpers({
		eventBus: bus,
		workflowId: run.graph?.name || "server_pipeline",
		resolveRunId: () => run.id,
		resolveFactoryId: () => String(ctx.get("factory_id") || "").trim(),
		defaultOwner: "apps.hatch.reactor",
	});
	const detachReactorTelemetry = reactorInstrumentation.bind();
	setLifecycleProjectionEmitter(run.id, null);
	setLifecycleProjectionEmitter(run.id, (events) => {
		reactorInstrumentation.emitRunLifecycleEvents(events);
	});
	bus.on((e) => {
		run.events.push(e);
	});

	let runRegistry = registry;
	if (isServerRegistryBuilder(registry)) {
		runRegistry = await registry.buildRegistry({
			eventBus: bus,
			onSessionTelemetryEvent: undefined,
		});
	}
	if (handlerConfig && run.graph) {
		const perRunConfig: HandlerConfig = {
			...handlerConfig,
			graph: run.graph,
			pipelineFile: run.graph.name,
			eventBus: bus,
		};
		runRegistry = new HandlerRegistry();
		registerAll(runRegistry, perRunConfig);
	}

	const engine = new Engine(run.graph!, runRegistry as HandlerRegistryLike, {
		eventBus: bus,
		context: ctx,
		pipelineFile: run.graph?.name || "",
	});

	try {
		await engine.run();
		run.status = "completed";
	} catch {
		run.status = "failed";
	} finally {
		try {
			detachReactorTelemetry();
			await flushOtelRuntime();
			await shutdownOtelRuntime();
			persistLifecycleContextFromEngine(engine);
		} catch {
			// non-blocking lifecycle flush path
		} finally {
			setLifecycleProjectionEmitter(run.id, null);
		}
	}
}

function sendJSON(res: ServerResponse, status: number, data: any): void {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let body = "";
		req.on("data", (chunk) => (body += chunk));
		req.on("end", () => resolve(body));
		req.on("error", reject);
	});
}
