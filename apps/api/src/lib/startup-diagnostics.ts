import { access, constants as fsConstants } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { execa } from "execa";
import { prisma } from "@forgeflow/db";
import { resolveCliPath } from "@forgeflow/opencode-adapter";

import { env } from "./env.js";

type DiagnosticStatus = "pass" | "warn" | "fail";

export interface StartupDiagnosticCheck {
  id: string;
  label: string;
  status: DiagnosticStatus;
  summary: string;
  details?: Record<string, unknown>;
}

export interface StartupDiagnosticsReport {
  checkedAt: string;
  overallStatus: DiagnosticStatus;
  checks: StartupDiagnosticCheck[];
}

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

async function pathExists(filePath: string) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function accessCheck(filePath: string) {
  try {
    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function computeOverallStatus(checks: StartupDiagnosticCheck[]): DiagnosticStatus {
  if (checks.some((check) => check.status === "fail")) {
    return "fail";
  }

  if (checks.some((check) => check.status === "warn")) {
    return "warn";
  }

  return "pass";
}

async function runCliVersionCheck() {
  const cliPath = await resolveCliPath(env.OPENCODE_CLI_PATH);
  const normalizedPath = cliPath.replace(/\\/g, path.sep);

  if (
    normalizedPath.includes(`${path.sep}node_modules${path.sep}opencode-ai${path.sep}bin${path.sep}opencode`) &&
    await pathExists(normalizedPath)
  ) {
    return execa(process.execPath, [normalizedPath, "--version"], {
      reject: false,
      windowsHide: true,
    });
  }

  if (process.platform === "win32" && normalizedPath.endsWith(".ps1")) {
    return execa("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", normalizedPath, "--version"], {
      reject: false,
      windowsHide: true,
    });
  }

  return execa(cliPath, ["--version"], {
    reject: false,
    windowsHide: true,
    shell: process.platform === "win32" && (normalizedPath.endsWith(".cmd") || normalizedPath.endsWith(".bat")),
  });
}

async function checkEnvConfiguration(): Promise<StartupDiagnosticCheck> {
  const expectedApiBase = `http://127.0.0.1:${env.PORT}`;
  const configuredApiBase = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || null;
  const envFilePath = path.join(workspaceRoot, ".env");
  const envLocalPath = path.join(workspaceRoot, ".env.local");
  const envFileExists = await pathExists(envFilePath);
  const envLocalExists = await pathExists(envLocalPath);
  const warnings: string[] = [];

  if (!envFileExists && !envLocalExists) {
    return {
      id: "env",
      label: "Environment",
      status: "fail",
      summary: "Neither .env nor .env.local exists in the workspace root.",
      details: {
        expectedFiles: [envFilePath, envLocalPath],
      },
    };
  }

  if (!configuredApiBase) {
    warnings.push("NEXT_PUBLIC_API_BASE_URL is not set; the web app will rely on its built-in default.");
  } else if (!configuredApiBase.startsWith(expectedApiBase)) {
    warnings.push(`NEXT_PUBLIC_API_BASE_URL points to ${configuredApiBase}, expected ${expectedApiBase}.`);
  }

  return {
    id: "env",
    label: "Environment",
    status: warnings.length > 0 ? "warn" : "pass",
    summary:
      warnings.length > 0
        ? warnings[0]
        : "Required environment variables and local env files are present.",
    details: {
      port: env.PORT,
      databaseUrl: env.DATABASE_URL,
      envFileExists,
      envLocalExists,
      configuredApiBase,
      expectedApiBase,
      warnings,
    },
  };
}

async function checkDatabaseConnectivity(): Promise<StartupDiagnosticCheck> {
  try {
    await prisma.$queryRawUnsafe("SELECT 1");

    return {
      id: "database",
      label: "Database",
      status: "pass",
      summary: "SQLite/Prisma connection succeeded.",
      details: {
        databaseUrl: env.DATABASE_URL,
      },
    };
  } catch (error) {
    return {
      id: "database",
      label: "Database",
      status: "fail",
      summary: error instanceof Error ? error.message : "Database connection failed.",
      details: {
        databaseUrl: env.DATABASE_URL,
      },
    };
  }
}

async function checkOpencodeCli(): Promise<StartupDiagnosticCheck> {
  const resolvedPath = await resolveCliPath(env.OPENCODE_CLI_PATH);
  const explicitPath = env.OPENCODE_CLI_PATH?.trim() || null;
  const looksLikeBareCommand = !resolvedPath.includes(path.sep) && !resolvedPath.includes("/");
  const exists = looksLikeBareCommand ? true : await pathExists(resolvedPath);
  const executable = looksLikeBareCommand ? true : await accessCheck(resolvedPath);

  try {
    const version = await runCliVersionCheck();

    if (version.exitCode !== 0) {
      return {
        id: "opencode-cli",
        label: "OpenCode CLI",
        status: "fail",
        summary: version.stderr.trim() || version.stdout.trim() || "OpenCode CLI returned a non-zero exit code.",
        details: {
          configuredPath: explicitPath,
          resolvedPath,
          exists,
          executable,
          exitCode: version.exitCode,
        },
      };
    }

    return {
      id: "opencode-cli",
      label: "OpenCode CLI",
      status: "pass",
      summary: `OpenCode CLI is runnable (${version.stdout.trim() || version.stderr.trim() || "version ok"}).`,
      details: {
        configuredPath: explicitPath,
        resolvedPath,
        exists,
        executable,
      },
    };
  } catch (error) {
    return {
      id: "opencode-cli",
      label: "OpenCode CLI",
      status: "fail",
      summary: error instanceof Error ? error.message : "OpenCode CLI could not be launched.",
      details: {
        configuredPath: explicitPath,
        resolvedPath,
        exists,
        executable,
      },
    };
  }
}

async function checkExecutorMode(): Promise<StartupDiagnosticCheck> {
  const baseUrl = env.OPENCODE_BASE_URL?.trim() || null;
  const cliPath = await resolveCliPath(env.OPENCODE_CLI_PATH);

  if (baseUrl) {
    return {
      id: "executor",
      label: "Execution Provider",
      status: "pass",
      summary: `HTTP executor configured via OPENCODE_BASE_URL: ${baseUrl}`,
      details: {
        mode: "http",
        baseUrl,
      },
    };
  }

  return {
    id: "executor",
    label: "Execution Provider",
    status: "warn",
    summary: "No OPENCODE_BASE_URL configured. ForgeFlow will rely on the local OpenCode CLI.",
    details: {
      mode: "cli",
      resolvedCliPath: cliPath,
    },
  };
}

export async function runStartupDiagnostics(): Promise<StartupDiagnosticsReport> {
  const checks = await Promise.all([
    checkEnvConfiguration(),
    checkDatabaseConnectivity(),
    checkOpencodeCli(),
    checkExecutorMode(),
  ]);

  return {
    checkedAt: new Date().toISOString(),
    overallStatus: computeOverallStatus(checks),
    checks,
  };
}
