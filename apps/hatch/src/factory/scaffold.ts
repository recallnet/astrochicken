import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export interface FactoryTemplateValues {
	factory_id: string;
	factory_name: string;
	instance_id: string;
	target_repo: string;
	control_plane_repo: string;
	tracking_issue_url: string;
	dispatch_graph: string;
	trust_domain: string;
	provider: string;
	model: string;
	runs_dir: string;
}

export interface ScaffoldFactoryOptions {
	rootDir?: string;
	templateRoot?: string;
	policyPackTemplateRoot?: string;
	factoryId: string;
	values: FactoryTemplateValues;
	force?: boolean;
}

export interface ScaffoldFactoryResult {
	factoryRoot: string;
	writtenFiles: string[];
}

interface CopyTemplateDirOptions {
	sourceRoot: string;
	targetRoot: string;
	rootDir: string;
	values?: Record<string, string>;
}

function renderTemplate(input: string, values: Record<string, string>): string {
	return input.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_full, key: string) => values[key] ?? "");
}

function renderPath(input: string, values: Record<string, string>): string {
	return input.replace(/__([A-Z0-9_]+)__/g, (_full, key: string) => {
		const lookup = key.toLowerCase();
		return values[lookup] ?? "";
	});
}

function copyTemplateDir({ sourceRoot, targetRoot, rootDir, values }: CopyTemplateDirOptions): string[] {
	const writtenFiles: string[] = [];
	const stack = [sourceRoot];

	while (stack.length > 0) {
		const current = stack.pop()!;
		for (const entry of readdirSync(current)) {
			const sourcePath = join(current, entry);
			const sourceStat = statSync(sourcePath);
			if (sourceStat.isDirectory()) {
				stack.push(sourcePath);
				continue;
			}

			const relPath = relative(sourceRoot, sourcePath);
			const resolvedRelPath = values ? renderPath(relPath, values) : relPath;
			const targetRelPath = resolvedRelPath.endsWith(".template")
				? resolvedRelPath.slice(0, Math.max(0, resolvedRelPath.length - ".template".length))
				: resolvedRelPath;
			const targetPath = join(targetRoot, targetRelPath);
			mkdirSync(dirname(targetPath), { recursive: true });

			if (values && sourcePath.endsWith(".template")) {
				const template = readFileSync(sourcePath, "utf8");
				writeFileSync(targetPath, renderTemplate(template, values));
			} else {
				cpSync(sourcePath, targetPath);
			}

			if (sourceStat.mode & 0o111 || targetPath.endsWith(".sh")) {
				chmodSync(targetPath, 0o755);
			}

			writtenFiles.push(relative(rootDir, targetPath));
		}
	}

	return writtenFiles;
}

export function scaffoldFactory(options: ScaffoldFactoryOptions): ScaffoldFactoryResult {
	const rootDir = resolve(options.rootDir ?? process.cwd());
	const templateRoot = resolve(options.templateRoot ?? join(rootDir, "factories", "_templates", "factory"));
	const policyPackTemplateRoot = resolve(
		options.policyPackTemplateRoot ?? join(rootDir, "factories", "_templates", "policy-pack", "v1"),
	);
	const factoryRoot = resolve(rootDir, "factories", options.factoryId);

	if (!existsSync(templateRoot)) {
		throw new Error(`factory template root not found: ${templateRoot}`);
	}
	if (!existsSync(policyPackTemplateRoot)) {
		throw new Error(`policy pack template root not found: ${policyPackTemplateRoot}`);
	}

	if (existsSync(factoryRoot)) {
		if (!options.force) {
			throw new Error(`factory already exists: factories/${options.factoryId} (use --force to overwrite)`);
		}
		rmSync(factoryRoot, { recursive: true, force: true });
	}

	mkdirSync(factoryRoot, { recursive: true });
	const values: Record<string, string> = {
		...options.values,
		factory_id: options.factoryId,
	};

	const writtenFiles = [
		...copyTemplateDir({ sourceRoot: templateRoot, targetRoot: factoryRoot, rootDir, values }),
		...copyTemplateDir({
			sourceRoot: policyPackTemplateRoot,
			targetRoot: join(factoryRoot, "policy-pack", "v1"),
			rootDir,
		}),
	];

	writtenFiles.sort((a, b) => a.localeCompare(b));
	return { factoryRoot, writtenFiles };
}
