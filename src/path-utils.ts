import * as path from "node:path";

export function normalizePath(filePath: string): string {
	const slashNormalized = filePath.replace(/\\/g, "/");
	const normalized = path.posix.normalize(slashNormalized);
	if (normalized.length > 1 && normalized.endsWith("/")) {
		return normalized.slice(0, -1);
	}
	return normalized;
}

export function uriToNormalizedPath(fileUri: string): string | null {
	try {
		const url = new URL(fileUri);
		if (url.protocol !== "file:") return null;
		const decoded = decodeURIComponent(url.pathname);
		const withoutWindowsPrefix = decoded.replace(/^\/([A-Za-z]:\/)/, "$1");
		return normalizePath(withoutWindowsPrefix);
	} catch {
		return null;
	}
}

export function toRepoRelativePath(filePath: string, repoRoot: string): string {
	const relative = path.relative(repoRoot, filePath).replace(/\\/g, "/");
	return relative.length > 0 ? relative : ".";
}

export function isPathInsideRoot(
	rootPath: string,
	targetPath: string,
): boolean {
	const resolvedRoot = path.resolve(rootPath);
	const resolvedTarget = path.resolve(targetPath);
	const relative = path.relative(resolvedRoot, resolvedTarget);
	return (
		relative === "" ||
		(!relative.startsWith("..") && !path.isAbsolute(relative))
	);
}

export function resolvePathInsideRoot(
	rootPath: string,
	configuredPath: string,
	fallbackPath: string,
): string {
	const resolvedRoot = path.resolve(rootPath);
	const resolvedConfigured = path.resolve(resolvedRoot, configuredPath);
	if (isPathInsideRoot(resolvedRoot, resolvedConfigured)) {
		return resolvedConfigured;
	}
	return path.resolve(resolvedRoot, fallbackPath);
}
