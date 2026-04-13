import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ProjectChangeSet } from "./execution-boundaries.js";
import { assertPathWithinRoot } from "./execution-boundaries.js";

const SKIPPED_DIRECTORIES = new Set([
  ".forgeflow",
  ".git",
  ".next",
  ".turbo",
  "backups",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

export type SyncDryRunResult = {
  added: Array<{ path: string; sourcePath: string; targetPath: string }>;
  modified: Array<{ path: string; sourcePath: string; targetPath: string }>;
  deleted: Array<{ path: string; targetPath: string }>;
};

function sanitizeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "workspace";
}

function workspaceRoot(projectRootPath: string) {
  const projectName = sanitizeSegment(path.basename(projectRootPath));
  return path.join(os.tmpdir(), "forgeflow-workspaces", projectName);
}

function shouldSkip(entryPath: string) {
  const segments = entryPath.replace(/\\/g, "/").split("/");
  return segments.some((segment) => SKIPPED_DIRECTORIES.has(segment));
}

export async function createExecutionWorkspace(input: {
  projectRootPath: string;
  taskCode: string;
  stage: string;
}) {
  const baseDirectory = workspaceRoot(input.projectRootPath);
  const workspacePath = path.join(baseDirectory, `${sanitizeSegment(input.taskCode)}-${sanitizeSegment(input.stage)}`);

  await fs.rm(workspacePath, { recursive: true, force: true });
  await fs.mkdir(workspacePath, { recursive: true });

  const entries = await fs.readdir(input.projectRootPath, { withFileTypes: true });

  for (const entry of entries) {
    if (SKIPPED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const sourcePath = path.join(input.projectRootPath, entry.name);
    const targetPath = path.join(workspacePath, entry.name);

    await fs.cp(sourcePath, targetPath, {
      recursive: true,
      filter: (source) => {
        const relativePath = path.relative(input.projectRootPath, source);

        if (!relativePath) {
          return true;
        }

        return !shouldSkip(relativePath);
      },
    });
  }

  return workspacePath;
}

export async function syncWorkspaceChangesToProject(input: {
  projectRootPath: string;
  workspacePath: string;
  changes: ProjectChangeSet;
  dryRun?: boolean;
}): Promise<SyncDryRunResult | void> {
  const dryRunResult: SyncDryRunResult = {
    added: [],
    modified: [],
    deleted: [],
  };

  for (const relativePath of input.changes.added) {
    const sourcePath = assertPathWithinRoot(input.workspacePath, relativePath, "EXECUTION_WORKSPACE_PATH_ESCAPE");
    const targetPath = assertPathWithinRoot(input.projectRootPath, relativePath);

    if (input.dryRun) {
      dryRunResult.added.push({ path: relativePath, sourcePath, targetPath });
      continue;
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
  }

  for (const relativePath of input.changes.modified) {
    const sourcePath = assertPathWithinRoot(input.workspacePath, relativePath, "EXECUTION_WORKSPACE_PATH_ESCAPE");
    const targetPath = assertPathWithinRoot(input.projectRootPath, relativePath);

    if (input.dryRun) {
      dryRunResult.modified.push({ path: relativePath, sourcePath, targetPath });
      continue;
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
  }

  for (const relativePath of input.changes.deleted) {
    const targetPath = assertPathWithinRoot(input.projectRootPath, relativePath);

    if (input.dryRun) {
      dryRunResult.deleted.push({ path: relativePath, targetPath });
      continue;
    }

    await fs.rm(targetPath, { recursive: true, force: true });
  }

  if (input.dryRun) {
    return dryRunResult;
  }
}
