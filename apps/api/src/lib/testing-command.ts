import fs from "node:fs/promises";
import path from "node:path";

export const ACCESSIBILITY_SCRIPT_NAMES = ["test:a11y", "test:accessibility", "a11y", "accessibility"] as const;

type VerificationCommandInput = {
  projectRootPath: string;
  testCommand?: string | null;
  lintCommand?: string | null;
  buildCommand?: string | null;
};

export async function resolveTestingCommand(input: VerificationCommandInput): Promise<string | undefined> {
  const verificationCommand = input.testCommand ?? input.lintCommand ?? input.buildCommand;

  if (!verificationCommand) {
    return undefined;
  }

  const accessibilityCommand = await resolveAccessibilityCommand(input.projectRootPath, verificationCommand);
  return accessibilityCommand ? `${verificationCommand} && ${accessibilityCommand}` : verificationCommand;
}

export async function resolveAccessibilityCommand(
  projectRootPath: string,
  verificationCommand: string,
): Promise<string | undefined> {
  try {
    const packageJsonPath = path.join(projectRootPath, "package.json");
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    const scripts = packageJson.scripts ?? {};

    for (const scriptName of ACCESSIBILITY_SCRIPT_NAMES) {
      if (!scripts[scriptName] || verificationCommand.includes(scriptName)) {
        continue;
      }

      return formatScriptCommand(scriptName, verificationCommand);
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function formatScriptCommand(scriptName: string, verificationCommand: string) {
  if (/\bbun\b/.test(verificationCommand)) {
    return `bun run ${scriptName}`;
  }

  if (/\byarn\b/.test(verificationCommand)) {
    return `yarn ${scriptName}`;
  }

  if (/\bpnpm\b/.test(verificationCommand)) {
    return `pnpm run ${scriptName}`;
  }

  return `npm run ${scriptName}`;
}
