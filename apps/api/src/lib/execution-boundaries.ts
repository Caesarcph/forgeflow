import { promises as fs } from "node:fs";
import path from "node:path";

import { ForgeFlowExecutionError } from "@forgeflow/opencode-adapter";

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  ".forgeflow",
]);

type ProjectSnapshot = Map<string, string>;

export interface ProjectChangeSet {
  all: string[];
  added: string[];
  modified: string[];
  deleted: string[];
}

export interface BoundaryValidationResult {
  changes: ProjectChangeSet;
  violations: string[];
}

function normalizeRelativePath(relativePath: string) {
  return relativePath.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
}

export function assertPathWithinRoot(rootPath: string, relativePath: string, code = "EXECUTION_PATH_OUTSIDE_PROJECT_ROOT") {
  const normalizedRoot = path.resolve(rootPath);
  const resolvedPath = path.resolve(normalizedRoot, relativePath);

  if (resolvedPath !== normalizedRoot && !resolvedPath.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new ForgeFlowExecutionError({
      code,
      message: `Resolved path escapes project root: ${relativePath}`,
      details: {
        rootPath: normalizedRoot,
        relativePath,
        resolvedPath,
      },
    });
  }

  return resolvedPath;
}

function shouldSkipDirectory(name: string) {
  return SKIPPED_DIRECTORIES.has(name);
}

async function walkProjectFiles(rootPath: string, currentPath: string, snapshot: ProjectSnapshot): Promise<void> {
  const entries = await fs.readdir(currentPath, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    const absolutePath = path.join(currentPath, entry.name);

    if (entry.isDirectory()) {
      if (shouldSkipDirectory(entry.name)) {
        continue;
      }

      await walkProjectFiles(rootPath, absolutePath, snapshot);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const stats = await fs.stat(absolutePath).catch(() => null);

    if (!stats) {
      continue;
    }

    const relativePath = normalizeRelativePath(path.relative(rootPath, absolutePath));
    snapshot.set(relativePath, `${stats.size}:${Math.trunc(stats.mtimeMs)}`);
  }
}

export async function captureProjectSnapshot(projectRootPath: string): Promise<ProjectSnapshot> {
  const snapshot = new Map<string, string>();
  await walkProjectFiles(projectRootPath, projectRootPath, snapshot);
  return snapshot;
}

export function diffProjectSnapshots(before: ProjectSnapshot, after: ProjectSnapshot): ProjectChangeSet {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const [relativePath, signature] of after.entries()) {
    if (!before.has(relativePath)) {
      added.push(relativePath);
      continue;
    }

    if (before.get(relativePath) !== signature) {
      modified.push(relativePath);
    }
  }

  for (const relativePath of before.keys()) {
    if (!after.has(relativePath)) {
      deleted.push(relativePath);
    }
  }

  const all = Array.from(new Set([...added, ...modified, ...deleted])).sort();

  return {
    all,
    added: added.sort(),
    modified: modified.sort(),
    deleted: deleted.sort(),
  };
}

function matchesConfiguredPath(relativePath: string, configuredPath: string) {
  const normalizedFile = normalizeRelativePath(relativePath);
  const normalizedConfig = normalizeRelativePath(configuredPath);

  if (!normalizedConfig || normalizedConfig === ".") {
    return true;
  }

  return normalizedFile === normalizedConfig || normalizedFile.startsWith(`${normalizedConfig}/`);
}

export function validateBoundaryChanges(input: {
  changes: ProjectChangeSet;
  allowedPaths: string[];
  blockedPaths: string[];
  canWriteFiles: boolean;
}): BoundaryValidationResult {
  const violations: string[] = [];

  if (!input.canWriteFiles && input.changes.all.length > 0) {
    violations.push(
      `Role is not allowed to write files but modified: ${input.changes.all.slice(0, 8).join(", ")}${input.changes.all.length > 8 ? "..." : ""}`,
    );
  }

  const blockedMatches = input.changes.all.filter((relativePath) =>
    input.blockedPaths.some((blockedPath) => matchesConfiguredPath(relativePath, blockedPath)),
  );

  if (blockedMatches.length > 0) {
    violations.push(`Blocked paths were modified: ${blockedMatches.join(", ")}`);
  }

  if (input.allowedPaths.length > 0) {
    const outsideAllowed = input.changes.all.filter(
      (relativePath) => !input.allowedPaths.some((allowedPath) => matchesConfiguredPath(relativePath, allowedPath)),
    );

    if (outsideAllowed.length > 0) {
      violations.push(`Files outside allowed paths were modified: ${outsideAllowed.join(", ")}`);
    }
  }

  return {
    changes: input.changes,
    violations,
  };
}

export function assertBoundaryValidation(result: BoundaryValidationResult) {
  if (result.violations.length === 0) {
    return;
  }

  throw new ForgeFlowExecutionError({
    code: "EXECUTION_BOUNDARY_VIOLATION",
    message: result.violations.join(" | "),
    details: {
      changes: result.changes,
      violations: result.violations,
    },
  });
}
