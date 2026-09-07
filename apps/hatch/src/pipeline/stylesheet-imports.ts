import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { graphModelStylesheet, type Graph } from "./graph.js";
import { parseStylesheet, type Stylesheet } from "./stylesheet.js";
import { applyStylesheet } from "./transform.js";

export type StylesheetImportErrorCode =
	| "stylesheet_import.missing"
	| "stylesheet_import.parse"
	| "stylesheet_import.circular";

export interface StylesheetImportFileSystem {
	existsSync(path: string): boolean;
	readFileSync(path: string, encoding: "utf-8"): string;
}

export interface StylesheetImportErrorDetails {
	graphFile: string;
	importerFile: string;
	importLiteral: string;
	attemptedPaths: string[];
	importOrder: number;
	importCount: number;
}

export class StylesheetImportError extends Error {
	readonly code: StylesheetImportErrorCode;
	readonly details: StylesheetImportErrorDetails;
	readonly causeValue: unknown;

	constructor(
		code: StylesheetImportErrorCode,
		message: string,
		details: StylesheetImportErrorDetails,
		causeValue?: unknown,
	) {
		super(message);
		this.name = this.constructor.name;
		this.code = code;
		this.details = details;
		this.causeValue = causeValue;
	}
}

export class MissingStylesheetImportError extends StylesheetImportError {
	constructor(message: string, details: StylesheetImportErrorDetails, causeValue?: unknown) {
		super("stylesheet_import.missing", message, details, causeValue);
	}
}

export class StylesheetImportParseError extends StylesheetImportError {
	constructor(message: string, details: StylesheetImportErrorDetails, causeValue?: unknown) {
		super("stylesheet_import.parse", message, details, causeValue);
	}
}

export class CircularStylesheetImportError extends StylesheetImportError {
	readonly cycle: string[];

	constructor(message: string, details: StylesheetImportErrorDetails, cycle: string[]) {
		super("stylesheet_import.circular", message, details);
		this.cycle = cycle;
	}
}

export interface LoadStylesheetImportsArgs {
	graphFile: string;
	imports: string[];
	repoRootPath?: string;
	fs?: StylesheetImportFileSystem;
}

export interface ApplyGraphStylesheetImportsArgs {
	graph: Graph;
	graphFile: string;
	stylesheetImports: string[];
	repoRootPath?: string;
	fs?: StylesheetImportFileSystem;
}

export interface ApplyGraphStylesheetImportsResult {
	importedStylesheet: Stylesheet;
	inlineStylesheet: Stylesheet;
	effectiveStylesheet: Stylesheet;
}

const DEFAULT_FS: StylesheetImportFileSystem = {
	existsSync,
	readFileSync,
};

const EMPTY_STYLESHEET: Stylesheet = { rules: [] };
const IMPORT_DIRECTIVE_REGEX = /^@import\s+"([^"\n]+)"\s*;?\s*$/;

interface ImportContext {
	graphFile: string;
	repoRootPath: string;
	fs: StylesheetImportFileSystem;
	importOrder: number;
	importCount: number;
}

interface ResolveImportPathResult {
	resolvedPath: string;
	attemptedPaths: string[];
}

interface ParsedStylesheetSource {
	imports: string[];
	stylesheetSource: string;
}

export function loadStylesheetImports(args: LoadStylesheetImportsArgs): Stylesheet {
	const imports = args.imports.filter((entry) => String(entry || "").trim().length > 0);
	if (imports.length === 0) {
		return EMPTY_STYLESHEET;
	}

	const contextBase = {
		graphFile: resolve(args.graphFile),
		repoRootPath: resolve(args.repoRootPath || process.cwd()),
		fs: args.fs || DEFAULT_FS,
	};

	const mergedRules: Stylesheet["rules"] = [];
	for (let index = 0; index < imports.length; index++) {
		const importLiteral = imports[index];
		const context: ImportContext = {
			...contextBase,
			importOrder: index + 1,
			importCount: imports.length,
		};

		const resolved = resolveImportPath({
			importerFile: context.graphFile,
			importLiteral,
			context,
		});

		const rules = loadStylesheetRulesRecursive({
			stylesheetFile: resolved.resolvedPath,
			context,
			rootImportLiteral: importLiteral,
			rootAttemptedPaths: resolved.attemptedPaths,
			stack: [],
		});
		mergedRules.push(...rules);
	}

	return { rules: mergedRules };
}

export function applyGraphStylesheetImports(args: ApplyGraphStylesheetImportsArgs): ApplyGraphStylesheetImportsResult {
	const importedStylesheet = loadStylesheetImports({
		graphFile: args.graphFile,
		imports: args.stylesheetImports,
		repoRootPath: args.repoRootPath,
		fs: args.fs,
	});
	const inlineRaw = graphModelStylesheet(args.graph);
	const inlineStylesheet = inlineRaw ? parseStylesheet(inlineRaw) : EMPTY_STYLESHEET;
	const effectiveStylesheet = {
		rules: [...importedStylesheet.rules, ...inlineStylesheet.rules],
	};

	if (effectiveStylesheet.rules.length > 0) {
		applyStylesheet(args.graph, effectiveStylesheet);
	}

	return {
		importedStylesheet,
		inlineStylesheet,
		effectiveStylesheet,
	};
}

function loadStylesheetRulesRecursive(args: {
	stylesheetFile: string;
	context: ImportContext;
	rootImportLiteral: string;
	rootAttemptedPaths: string[];
	stack: string[];
}): Stylesheet["rules"] {
	const stylesheetFile = resolve(args.stylesheetFile);
	const cycleIndex = args.stack.indexOf(stylesheetFile);
	if (cycleIndex >= 0) {
		const cycle = [...args.stack.slice(cycleIndex), stylesheetFile];
		const cycleDisplay = cycle.map((entry) => quotePath(entry)).join(" -> ");
		throw new CircularStylesheetImportError(
			formatImportErrorPrefix(args.context, args.rootImportLiteral)
				+ `circular stylesheet import detected: ${cycleDisplay}`,
			buildImportDetails({
				context: args.context,
				importerFile: args.stack.at(-1) || args.context.graphFile,
				importLiteral: args.rootImportLiteral,
				attemptedPaths: args.rootAttemptedPaths,
			}),
			cycle,
		);
	}

	let source: string;
	try {
		source = args.context.fs.readFileSync(stylesheetFile, "utf-8");
	} catch (error) {
		throw new MissingStylesheetImportError(
			formatImportErrorPrefix(args.context, args.rootImportLiteral)
				+ `unable to read stylesheet ${quotePath(stylesheetFile)}: ${String(error instanceof Error ? error.message : error)}`,
			buildImportDetails({
				context: args.context,
				importerFile: args.stack.at(-1) || args.context.graphFile,
				importLiteral: args.rootImportLiteral,
				attemptedPaths: args.rootAttemptedPaths,
			}),
			error,
		);
	}

	const parsedSource = parseStylesheetSource({
		source,
		stylesheetFile,
		context: args.context,
		rootImportLiteral: args.rootImportLiteral,
		rootAttemptedPaths: args.rootAttemptedPaths,
	});

	const nextStack = [...args.stack, stylesheetFile];
	const nestedRules: Stylesheet["rules"] = [];
	for (const nestedImportLiteral of parsedSource.imports) {
		const resolvedNested = resolveImportPath({
			importerFile: stylesheetFile,
			importLiteral: nestedImportLiteral,
			context: args.context,
		});
		nestedRules.push(...loadStylesheetRulesRecursive({
			stylesheetFile: resolvedNested.resolvedPath,
			context: args.context,
			rootImportLiteral: args.rootImportLiteral,
			rootAttemptedPaths: args.rootAttemptedPaths,
			stack: nextStack,
		}));
	}

	let parsedStylesheet: Stylesheet;
	try {
		parsedStylesheet = parseStylesheet(parsedSource.stylesheetSource);
	} catch (error) {
		throw new StylesheetImportParseError(
			formatImportErrorPrefix(args.context, args.rootImportLiteral)
				+ `failed to parse stylesheet ${quotePath(stylesheetFile)}: ${String(error instanceof Error ? error.message : error)}`,
			buildImportDetails({
				context: args.context,
				importerFile: stylesheetFile,
				importLiteral: args.rootImportLiteral,
				attemptedPaths: args.rootAttemptedPaths,
			}),
			error,
		);
	}

	return [...nestedRules, ...parsedStylesheet.rules];
}

function resolveImportPath(args: {
	importerFile: string;
	importLiteral: string;
	context: ImportContext;
}): ResolveImportPathResult {
	const importLiteral = String(args.importLiteral || "").trim();
	if (!importLiteral.endsWith(".stylesheet")) {
		throw new StylesheetImportParseError(
			formatImportErrorPrefix(args.context, importLiteral)
				+ `invalid import literal ${JSON.stringify(importLiteral)} (expected path ending with .stylesheet)`,
			buildImportDetails({
				context: args.context,
				importerFile: resolve(args.importerFile),
				importLiteral,
				attemptedPaths: [],
			}),
		);
	}

	const importerFile = resolve(args.importerFile);
	const attemptedPaths: string[] = [];
	const tryPath = (candidate: string): string | null => {
		const resolvedCandidate = resolve(candidate);
		if (!attemptedPaths.includes(resolvedCandidate)) {
			attemptedPaths.push(resolvedCandidate);
		}
		if (!args.context.fs.existsSync(resolvedCandidate)) {
			return null;
		}
		return resolvedCandidate;
	};

	if (isAbsolute(importLiteral)) {
		const absolutePath = tryPath(importLiteral);
		if (absolutePath) {
			return { resolvedPath: absolutePath, attemptedPaths };
		}
	} else {
		const graphRelativePath = tryPath(resolve(dirname(importerFile), importLiteral));
		if (graphRelativePath) {
			return { resolvedPath: graphRelativePath, attemptedPaths };
		}

		const rootRelativePath = tryPath(resolve(args.context.repoRootPath, importLiteral));
		if (rootRelativePath) {
			return { resolvedPath: rootRelativePath, attemptedPaths };
		}
	}

	throw new MissingStylesheetImportError(
		formatImportErrorPrefix(args.context, importLiteral)
			+ `unable to resolve import from ${quotePath(importerFile)}; attempted ${attemptedPaths.map((entry) => quotePath(entry)).join(", ") || "(none)"}`,
		buildImportDetails({
			context: args.context,
			importerFile,
			importLiteral,
			attemptedPaths,
		}),
	);
}

function parseStylesheetSource(args: {
	source: string;
	stylesheetFile: string;
	context: ImportContext;
	rootImportLiteral: string;
	rootAttemptedPaths: string[];
}): ParsedStylesheetSource {
	const lines = args.source.split(/\r?\n/);
	const imports: string[] = [];
	const contentLines: string[] = [];
	let braceDepth = 0;

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		const lineNumber = index + 1;
		const trimmed = line.trim();

		if (trimmed.startsWith("@import")) {
			if (braceDepth !== 0) {
				throw new StylesheetImportParseError(
					formatImportErrorPrefix(args.context, args.rootImportLiteral)
						+ `invalid nested @import in ${quotePath(args.stylesheetFile)} at line ${lineNumber}: @import is only allowed at top level`,
					buildImportDetails({
						context: args.context,
						importerFile: args.stylesheetFile,
						importLiteral: args.rootImportLiteral,
						attemptedPaths: args.rootAttemptedPaths,
					}),
				);
			}
			const match = trimmed.match(IMPORT_DIRECTIVE_REGEX);
			if (!match) {
				throw new StylesheetImportParseError(
					formatImportErrorPrefix(args.context, args.rootImportLiteral)
						+ `invalid @import syntax in ${quotePath(args.stylesheetFile)} at line ${lineNumber}: expected @import \"path/to/file.stylesheet\"`,
					buildImportDetails({
						context: args.context,
						importerFile: args.stylesheetFile,
						importLiteral: args.rootImportLiteral,
						attemptedPaths: args.rootAttemptedPaths,
					}),
				);
			}
			imports.push(match[1]);
			continue;
		}

		contentLines.push(line);
		braceDepth = updateBraceDepth({
			line,
			lineNumber,
			braceDepth,
			stylesheetFile: args.stylesheetFile,
			context: args.context,
			rootImportLiteral: args.rootImportLiteral,
			rootAttemptedPaths: args.rootAttemptedPaths,
		});
	}

	if (braceDepth !== 0) {
		throw new StylesheetImportParseError(
			formatImportErrorPrefix(args.context, args.rootImportLiteral)
				+ `unbalanced braces in ${quotePath(args.stylesheetFile)}`,
			buildImportDetails({
				context: args.context,
				importerFile: args.stylesheetFile,
				importLiteral: args.rootImportLiteral,
				attemptedPaths: args.rootAttemptedPaths,
			}),
		);
	}

	return {
		imports,
		stylesheetSource: contentLines.join("\n"),
	};
}

function updateBraceDepth(args: {
	line: string;
	lineNumber: number;
	braceDepth: number;
	stylesheetFile: string;
	context: ImportContext;
	rootImportLiteral: string;
	rootAttemptedPaths: string[];
}): number {
	let braceDepth = args.braceDepth;
	let inSingleQuote = false;
	let inDoubleQuote = false;
	let escaped = false;

	for (let index = 0; index < args.line.length; index++) {
		const char = args.line[index];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (char === "\\") {
			escaped = true;
			continue;
		}
		if (!inDoubleQuote && char === "'") {
			inSingleQuote = !inSingleQuote;
			continue;
		}
		if (!inSingleQuote && char === '"') {
			inDoubleQuote = !inDoubleQuote;
			continue;
		}
		if (inSingleQuote || inDoubleQuote) {
			continue;
		}
		if (char === "{") {
			braceDepth++;
			continue;
		}
		if (char === "}") {
			braceDepth--;
			if (braceDepth < 0) {
				throw new StylesheetImportParseError(
					formatImportErrorPrefix(args.context, args.rootImportLiteral)
						+ `unexpected closing brace in ${quotePath(args.stylesheetFile)} at line ${args.lineNumber}`,
					buildImportDetails({
						context: args.context,
						importerFile: args.stylesheetFile,
						importLiteral: args.rootImportLiteral,
						attemptedPaths: args.rootAttemptedPaths,
					}),
				);
			}
		}
	}

	return braceDepth;
}

function buildImportDetails(args: {
	context: ImportContext;
	importerFile: string;
	importLiteral: string;
	attemptedPaths: string[];
}): StylesheetImportErrorDetails {
	return {
		graphFile: resolve(args.context.graphFile),
		importerFile: resolve(args.importerFile),
		importLiteral: args.importLiteral,
		attemptedPaths: args.attemptedPaths.map((entry) => resolve(entry)),
		importOrder: args.context.importOrder,
		importCount: args.context.importCount,
	};
}

function formatImportErrorPrefix(context: ImportContext, importLiteral: string): string {
	return `stylesheet import ${context.importOrder}/${context.importCount} (${JSON.stringify(importLiteral)}) for graph ${quotePath(context.graphFile)}: `;
}

function quotePath(pathValue: string): string {
	return JSON.stringify(resolve(pathValue));
}
