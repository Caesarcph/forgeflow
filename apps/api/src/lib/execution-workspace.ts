import { promises as fs } from "node:fs";
import path from "node:path";

import type { ProjectChangeSet } from "./execution-boundaries.js";
import { assertPathWithinRoot } from "./execution-boundaries.js";

const SKIPPED_DIRECTORIES = new Set([
  ".forgeflow",
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

function workspaceRoot(projectRootPath: string) {
  return path.join(projectRootPath, ".forgeflow", "workspaces");
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
  const workspacePath = path.join(baseDirectory, `${input.taskCode}-${input.stage}`);

  await fs.rm(workspacePath, { recursive: true, force: true });
  await fs.mkdir(workspacePath, { recursive: true });

  await fs.cp(input.projectRootPath, workspacePath, {
    recursive: true,
    filter: (source) => {
      const relativePath = path.relative(input.projectRootPath, source);

      if (!relativePath) {
        return true;
      }

      return !shouldSkip(relativePath);
    },
  });

  return workspacePath;
}

export async function syncWorkspaceChangesToProject(input: {
  projectRootPath: string;
  workspacePath: string;
  changes: ProjectChangeSet;
}) {
  for (const relativePath of input.changes.added) {
    const sourcePath = assertPathWithinRoot(input.workspacePath, relativePath, "EXECUTION_WORKSPACE_PATH_ESCAPE");
    const targetPath = assertPathWithinRoot(input.projectRootPath, relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
  }

  for (const relativePath of input.changes.modified) {
    const sourcePath = assertPathWithinRoot(input.workspacePath, relativePath, "EXECUTION_WORKSPACE_PATH_ESCAPE");
    const targetPath = assertPathWithinRoot(input.projectRootPath, relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
  }

  for (const relativePath of input.changes.deleted) {
    const targetPath = assertPathWithinRoot(input.projectRootPath, relativePath);
    await fs.rm(targetPath, { recursive: true, force: true });
  }
}
