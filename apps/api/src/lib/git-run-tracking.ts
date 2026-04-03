import { promises as fs } from "node:fs";
import path from "node:path";

import { execa } from "execa";

import type { ProjectChangeSet } from "./execution-boundaries.js";
import { assertPathWithinRoot } from "./execution-boundaries.js";

export interface GitRepoState {
  isGitRepo: boolean;
  repoRoot: string | null;
  branch: string | null;
  headCommit: string | null;
  statusLines: string[];
}

export interface GitPreflightSummary extends GitRepoState {
  defaultBranch: string | null;
  hasUncommittedChanges: boolean;
  warnings: string[];
}

export interface RollbackManifest {
  projectRootPath: string;
  changedFiles: ProjectChangeSet;
  entries: Array<{
    path: string;
    existedBefore: boolean;
    backupPath: string | null;
  }>;
}

async function runGit(args: string[], cwd: string) {
  return execa("git", args, {
    cwd,
    reject: false,
    windowsHide: true,
  });
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getRunDirectory(projectRootPath: string, runId: string) {
  return path.join(projectRootPath, ".forgeflow", "runs", runId);
}

export async function captureGitRepoState(projectRootPath: string): Promise<GitRepoState> {
  const repoRootResult = await runGit(["rev-parse", "--show-toplevel"], projectRootPath);

  if (repoRootResult.exitCode !== 0) {
    return {
      isGitRepo: false,
      repoRoot: null,
      branch: null,
      headCommit: null,
      statusLines: [],
    };
  }

  const repoRoot = repoRootResult.stdout.trim();
  const [branchResult, headResult, statusResult] = await Promise.all([
    runGit(["rev-parse", "--abbrev-ref", "HEAD"], projectRootPath),
    runGit(["rev-parse", "HEAD"], projectRootPath),
    runGit(["status", "--short", "--untracked-files=all"], projectRootPath),
  ]);

  return {
    isGitRepo: true,
    repoRoot,
    branch: branchResult.exitCode === 0 ? branchResult.stdout.trim() : null,
    headCommit: headResult.exitCode === 0 ? headResult.stdout.trim() : null,
    statusLines: statusResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  };
}

export function summarizeGitPreflight(state: GitRepoState, defaultBranch?: string | null): GitPreflightSummary {
  const normalizedDefaultBranch = defaultBranch?.trim() ? defaultBranch.trim() : null;
  const warnings: string[] = [];

  if (!state.isGitRepo) {
    warnings.push("Project root is not inside a Git repository.");
  }

  if (state.statusLines.length > 0) {
    warnings.push(`Repository has ${state.statusLines.length} uncommitted change(s) before execution.`);
  }

  if (normalizedDefaultBranch && state.branch && state.branch !== normalizedDefaultBranch) {
    warnings.push(`Current branch is ${state.branch}, expected ${normalizedDefaultBranch}.`);
  }

  return {
    ...state,
    defaultBranch: normalizedDefaultBranch,
    hasUncommittedChanges: state.statusLines.length > 0,
    warnings,
  };
}

export async function prepareRollbackArtifacts(input: {
  runId: string;
  projectRootPath: string;
  changes: ProjectChangeSet;
}) {
  const runDirectory = getRunDirectory(input.projectRootPath, input.runId);
  const rollbackRoot = path.join(runDirectory, "rollback");
  const entries: RollbackManifest["entries"] = [];

  for (const relativePath of input.changes.all) {
    const sourcePath = assertPathWithinRoot(input.projectRootPath, relativePath);
    const existedBefore = await fileExists(sourcePath);
    const backupPath = existedBefore ? path.join(rollbackRoot, relativePath) : null;

    if (backupPath) {
      await fs.mkdir(path.dirname(backupPath), { recursive: true });
      await fs.copyFile(sourcePath, backupPath);
    }

    entries.push({
      path: relativePath,
      existedBefore,
      backupPath,
    });
  }

  const manifest: RollbackManifest = {
    projectRootPath: input.projectRootPath,
    changedFiles: input.changes,
    entries,
  };

  const manifestPath = path.join(runDirectory, "rollback-manifest.json");
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  return {
    manifest,
    manifestPath,
  };
}

export async function restoreRollbackManifest(manifest: RollbackManifest) {
  for (const entry of manifest.entries) {
    const targetPath = assertPathWithinRoot(manifest.projectRootPath, entry.path, "ROLLBACK_PATH_OUTSIDE_PROJECT_ROOT");

    if (entry.existedBefore && entry.backupPath) {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.copyFile(entry.backupPath, targetPath);
      continue;
    }

    await fs.rm(targetPath, { recursive: true, force: true });
  }
}

export async function readRollbackManifest(filePath: string) {
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content) as RollbackManifest;
}

export async function writeGitStateArtifacts(input: {
  runId: string;
  projectRootPath: string;
  before: GitRepoState;
  after: GitRepoState;
}) {
  const runDirectory = getRunDirectory(input.projectRootPath, input.runId);
  const beforePath = path.join(runDirectory, "git-state-before.json");
  const afterPath = path.join(runDirectory, "git-state-after.json");

  await Promise.all([
    fs.writeFile(beforePath, JSON.stringify(input.before, null, 2), "utf8"),
    fs.writeFile(afterPath, JSON.stringify(input.after, null, 2), "utf8"),
  ]);

  return {
    beforePath,
    afterPath,
  };
}

export async function writeGitDiffArtifact(input: {
  runId: string;
  projectRootPath: string;
  changedFiles: string[];
}) {
  const runDirectory = getRunDirectory(input.projectRootPath, input.runId);
  const diffPath = path.join(runDirectory, "git-diff.patch");

  if (input.changedFiles.length === 0) {
    await fs.writeFile(diffPath, "", "utf8");
    return {
      diffPath,
      hasDiff: false,
    };
  }

  const diffResult = await runGit(["diff", "--no-ext-diff", "--binary", "--", ...input.changedFiles], input.projectRootPath);
  await fs.writeFile(diffPath, diffResult.stdout ?? "", "utf8");

  return {
    diffPath,
    hasDiff: Boolean(diffResult.stdout?.trim()),
  };
}
