import { ForgeFlowExecutionError } from "@forgeflow/opencode-adapter";

const DANGEROUS_COMMAND_PATTERNS: Array<{ code: string; pattern: RegExp; reason: string }> = [
  {
    code: "CMD_DANGEROUS_DATABASE",
    pattern: /\bprisma\s+migrate\s+reset\b/i,
    reason: "destructive database reset",
  },
  {
    code: "CMD_DANGEROUS_DELETE",
    pattern: /\brm\s+-rf\b/i,
    reason: "recursive force delete",
  },
  {
    code: "CMD_DANGEROUS_DELETE",
    pattern: /\b(remove-item|ri)\b[\s\S]*\b(-recurse|\/s)\b[\s\S]*\b(-force|\/q|\/f)\b/i,
    reason: "recursive forced delete",
  },
  {
    code: "CMD_DANGEROUS_DELETE",
    pattern: /\b(del|erase)\b[\s\S]*\b(\/s|\/q|\/f)\b/i,
    reason: "Windows forced delete",
  },
  {
    code: "CMD_DANGEROUS_DELETE",
    pattern: /\b(rmdir|rd)\b[\s\S]*\b(\/s)\b/i,
    reason: "recursive directory delete",
  },
  {
    code: "CMD_DANGEROUS_SYSTEM",
    pattern: /\b(format|mkfs|diskpart)\b/i,
    reason: "disk formatting tooling",
  },
  {
    code: "CMD_DANGEROUS_SYSTEM",
    pattern: /\b(shutdown|reboot|halt|poweroff|restart-computer|stop-computer)\b/i,
    reason: "system shutdown or restart",
  },
  {
    code: "CMD_DANGEROUS_GIT",
    pattern: /\bgit\s+reset\s+--hard\b/i,
    reason: "destructive git reset",
  },
  {
    code: "CMD_DANGEROUS_GIT",
    pattern: /\bgit\s+clean\b[\s\S]*\b-f\b/i,
    reason: "destructive git clean",
  },
];

function normalizeCommand(command: string) {
  return command.replace(/\s+/g, " ").trim();
}

export type AgentShellToolUse = {
  command: string;
  workdir?: string;
  tool: string;
};

export function assertSafeShellCommand(command: string) {
  const normalized = normalizeCommand(command);

  for (const rule of DANGEROUS_COMMAND_PATTERNS) {
    if (!rule.pattern.test(normalized)) {
      continue;
    }

    throw new ForgeFlowExecutionError({
      code: "DANGEROUS_COMMAND_BLOCKED",
      message: `Command blocked by ForgeFlow safety policy: ${normalized}`,
      details: {
        command: normalized,
        matchedRule: rule.code,
        reason: rule.reason,
      },
    });
  }

  return normalized;
}

export function extractShellToolUseFromAgentLog(line: string): AgentShellToolUse | null {
  const jsonText = line.replace(/^(stdout|stderr):\s*/i, "").trim();

  if (!jsonText.startsWith("{")) {
    return null;
  }

  let payload: unknown;

  try {
    payload = JSON.parse(jsonText);
  } catch {
    return null;
  }

  if (!payload || typeof payload !== "object") {
    return null;
  }

  const event = payload as Record<string, unknown>;
  const part = event.part && typeof event.part === "object" ? (event.part as Record<string, unknown>) : event;
  const tool = typeof part.tool === "string" ? part.tool : typeof event.tool === "string" ? event.tool : "";
  const isShellTool = ["bash", "shell", "cmd", "powershell"].includes(tool.toLowerCase());

  if (!isShellTool) {
    return null;
  }

  const state = part.state && typeof part.state === "object" ? (part.state as Record<string, unknown>) : undefined;
  const input = state?.input && typeof state.input === "object" ? (state.input as Record<string, unknown>) : undefined;
  const command = input?.command;

  if (typeof command !== "string" || !command.trim()) {
    return null;
  }

  const workdir = typeof input?.workdir === "string" ? input.workdir : undefined;

  return {
    command,
    workdir,
    tool,
  };
}
