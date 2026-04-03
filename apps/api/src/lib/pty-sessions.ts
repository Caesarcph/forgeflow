import { promises as fs } from "node:fs";
import { EventEmitter } from "node:events";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { spawn, type IPty } from "node-pty";

type PtySessionStatus = "running" | "closed";

type PtySessionSnapshot = {
  id: string;
  cwd: string;
  shell: string;
  status: PtySessionStatus;
  createdAt: string;
  updatedAt: string;
  exitCode: number | null;
  output: string;
};

type PtySessionEvent =
  | { type: "snapshot"; session: PtySessionSnapshot }
  | { type: "output"; chunk: string; session: PtySessionSnapshot }
  | { type: "exit"; exitCode: number | null; session: PtySessionSnapshot };

type InternalPtySession = {
  id: string;
  cwd: string;
  shell: string;
  status: PtySessionStatus;
  createdAt: string;
  updatedAt: string;
  exitCode: number | null;
  output: string;
  pty: IPty;
  emitter: EventEmitter;
};

const OUTPUT_LIMIT = 250_000;
const sessions = new Map<string, InternalPtySession>();
const DEFAULT_PTY_SHELL = "powershell.exe";

function snapshot(session: InternalPtySession): PtySessionSnapshot {
  return {
    id: session.id,
    cwd: session.cwd,
    shell: session.shell,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    exitCode: session.exitCode,
    output: session.output,
  };
}

function emit(session: InternalPtySession, event: PtySessionEvent) {
  session.emitter.emit("event", event);
}

async function resolveCwd(input?: string) {
  const candidate = input?.trim() ? path.resolve(input.trim()) : process.cwd();

  try {
    const stats = await fs.stat(candidate);

    if (stats.isDirectory()) {
      return candidate;
    }
  } catch {
    // ignore and fall back
  }

  return process.cwd();
}

function appendOutput(session: InternalPtySession, chunk: string) {
  session.output = `${session.output}${chunk}`;

  if (session.output.length > OUTPUT_LIMIT) {
    session.output = session.output.slice(session.output.length - OUTPUT_LIMIT);
  }

  session.updatedAt = new Date().toISOString();
}

function stripAnsi(text: string) {
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

function trimCapturedOutput(text: string) {
  return stripAnsi(text).replace(/\r/g, "").trim();
}

function createPtyShell(cwd: string) {
  return spawn(DEFAULT_PTY_SHELL, ["-NoLogo"], {
    name: "xterm-color",
    cols: 120,
    rows: 32,
    cwd,
    env: process.env as Record<string, string>,
    useConptyDll: true,
  });
}

export async function createPtySession(input: { cwd?: string } = {}) {
  const cwd = await resolveCwd(input.cwd);
  const shell = DEFAULT_PTY_SHELL;
  const pty = createPtyShell(cwd);
  const now = new Date().toISOString();
  const session: InternalPtySession = {
    id: randomUUID(),
    cwd,
    shell,
    status: "running",
    createdAt: now,
    updatedAt: now,
    exitCode: null,
    output: "",
    pty,
    emitter: new EventEmitter(),
  };

  sessions.set(session.id, session);

  pty.onData((chunk) => {
    appendOutput(session, chunk);
    emit(session, {
      type: "output",
      chunk,
      session: snapshot(session),
    });
  });

  pty.onExit(({ exitCode }) => {
    session.status = "closed";
    session.exitCode = exitCode;
    session.updatedAt = new Date().toISOString();
    emit(session, {
      type: "exit",
      exitCode,
      session: snapshot(session),
    });
  });

  return snapshot(session);
}

export async function runPtyCommandProbe(input: {
  cwd?: string;
  command: string;
  timeoutMs: number;
  successPattern?: RegExp;
}) {
  const cwd = await resolveCwd(input.cwd);
  const successPattern = input.successPattern ?? /\bok\b/i;

  return await new Promise<{
    ok: boolean;
    timedOut: boolean;
    latencyMs: number;
    output: string;
    cwd: string;
    command: string;
  }>((resolve) => {
    const startedAt = Date.now();
    const pty = createPtyShell(cwd);
    let output = "";
    let finished = false;
    let completionRequested = false;
    let completionGraceTimeout: NodeJS.Timeout | null = null;

    const finish = (result: {
      ok: boolean;
      timedOut: boolean;
      output: string;
      forceKill?: boolean;
    }) => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timeout);
      clearTimeout(sendDelay);
      if (completionGraceTimeout) {
        clearTimeout(completionGraceTimeout);
      }

      if (result.forceKill) {
        try {
          pty.kill();
        } catch {
          // ignore
        }
      }

      resolve({
        ...result,
        latencyMs: Date.now() - startedAt,
        cwd,
        command: input.command,
      });
    };

    const timeout = setTimeout(() => {
      finish({
        ok: false,
        timedOut: true,
        output,
        forceKill: true,
      });
    }, input.timeoutMs);

    const sendDelay = setTimeout(() => {
      try {
        pty.write(`${input.command}\r`);
      } catch {
        finish({
          ok: false,
          timedOut: false,
          output,
        });
      }
    }, 200);

    pty.onData((chunk) => {
      output = `${output}${chunk}`;

      if (!completionRequested && successPattern.test(stripAnsi(output))) {
        completionRequested = true;

        try {
          pty.write("exit\r");
        } catch {
          finish({
            ok: true,
            timedOut: false,
            output,
            forceKill: true,
          });
          return;
        }

        completionGraceTimeout = setTimeout(() => {
          finish({
            ok: true,
            timedOut: false,
            output,
            forceKill: true,
          });
        }, 1500);
      }
    });

    pty.onExit(() => {
      if (!finished) {
        finish({
          ok: successPattern.test(stripAnsi(output)),
          timedOut: false,
          output,
        });
      }
    });
  });
}

export async function runPtyProcessCapture(input: {
  file: string;
  args: string[];
  cwd?: string;
  timeoutMs: number;
}) {
  const cwd = await resolveCwd(input.cwd);

  return await new Promise<{
    ok: boolean;
    timedOut: boolean;
    latencyMs: number;
    output: string;
    exitCode: number | null;
    cwd: string;
    commandLabel: string;
  }>((resolve) => {
    const startedAt = Date.now();
    const pty = spawn(input.file, input.args, {
      name: "xterm-color",
      cols: 120,
      rows: 32,
      cwd,
      env: process.env as Record<string, string>,
      useConptyDll: true,
    });
    const commandLabel = [input.file, ...input.args.filter((arg) => !arg.includes("\n")).slice(0, 8)].join(" ");
    let output = "";
    let finished = false;
    let exitCode: number | null = null;

    const finish = (result: {
      ok: boolean;
      timedOut: boolean;
      output: string;
      exitCode: number | null;
      forceKill?: boolean;
    }) => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timeout);

      if (result.forceKill) {
        try {
          pty.kill();
        } catch {
          // ignore
        }
      }

      resolve({
        ...result,
        latencyMs: Date.now() - startedAt,
        cwd,
        commandLabel,
      });
    };

    const timeout = setTimeout(() => {
      finish({
        ok: false,
        timedOut: true,
        output,
        exitCode,
        forceKill: true,
      });
    }, input.timeoutMs);

    pty.onData((chunk) => {
      output = `${output}${chunk}`;
    });

    pty.onExit(({ exitCode: nextExitCode }) => {
      exitCode = nextExitCode;
      finish({
        ok: nextExitCode === 0,
        timedOut: false,
        output,
        exitCode: nextExitCode,
      });
    });
  }).then((result) => ({
    ...result,
    output: trimCapturedOutput(result.output),
  }));
}

export function getPtySession(id: string) {
  const session = sessions.get(id);
  return session ? snapshot(session) : null;
}

export function subscribeToPtySession(id: string, listener: (event: PtySessionEvent) => void) {
  const session = sessions.get(id);

  if (!session) {
    return null;
  }

  const wrapped = (event: PtySessionEvent) => {
    listener(event);
  };

  session.emitter.on("event", wrapped);

  return () => {
    session.emitter.off("event", wrapped);
  };
}

export function writeToPtySession(id: string, input: string) {
  const session = sessions.get(id);

  if (!session) {
    return null;
  }

  if (session.status !== "running") {
    return snapshot(session);
  }

  session.pty.write(input);
  session.updatedAt = new Date().toISOString();
  return snapshot(session);
}

export function runCommandInPtySession(id: string, command: string) {
  const session = sessions.get(id);

  if (!session) {
    return null;
  }

  if (session.status !== "running") {
    return snapshot(session);
  }

  session.pty.write(`${command}\r`);
  session.updatedAt = new Date().toISOString();
  return snapshot(session);
}

export function resizePtySession(id: string, cols: number, rows: number) {
  const session = sessions.get(id);

  if (!session) {
    return null;
  }

  if (session.status === "running") {
    session.pty.resize(Math.max(40, cols), Math.max(10, rows));
    session.updatedAt = new Date().toISOString();
  }

  return snapshot(session);
}

export function closePtySession(id: string) {
  const session = sessions.get(id);

  if (!session) {
    return null;
  }

  if (session.status === "running") {
    session.pty.kill();
    session.status = "closed";
    session.updatedAt = new Date().toISOString();
  }

  return snapshot(session);
}
