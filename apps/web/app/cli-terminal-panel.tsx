"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { CLIENT_API_BASE_URL } from "../lib/client-api";
import { parseJsonResponse, readApiError } from "../lib/http";
import { useLanguage } from "./language-provider";

const API_BASE_URL = CLIENT_API_BASE_URL;

type TerminalSession = {
  id: string;
  cwd: string;
  shell: string;
  status: "running" | "closed";
  createdAt: string;
  updatedAt: string;
  exitCode: number | null;
  output: string;
};

type TerminalEvent =
  | { type: "snapshot"; session: TerminalSession }
  | { type: "output"; chunk: string; session: TerminalSession }
  | { type: "exit"; exitCode: number | null; session: TerminalSession }
  | { type: "error"; message: string };

export function CliTerminalPanel(input: {
  rootPath: string;
  intakeProvider: string;
  intakeModel: string;
}) {
  const { language } = useLanguage();
  const [session, setSession] = useState<TerminalSession | null>(null);
  const [command, setCommand] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [runningProbe, setRunningProbe] = useState(false);
  const [error, setError] = useState("");
  const eventSourceRef = useRef<EventSource | null>(null);
  const outputRef = useRef<HTMLPreElement | null>(null);

  const text = useMemo(
    () =>
      language === "zh"
        ? {
            title: "嵌入式 CLI",
            subtitle: "这个面板走 PTY，会更接近你手动在 PowerShell 里运行 opencode 的行为。",
            start: "启动终端",
            reconnect: "重新连接",
            close: "关闭终端",
            runProbe: "在终端里跑 Health Probe",
            cwd: "工作目录",
            shell: "Shell",
            status: "状态",
            command: "命令",
            placeholder: "例如：opencode run \"回复我一个ok\" --model opencode/qwen3.6-plus-free",
            send: "发送命令",
            interrupt: "发送 Ctrl+C",
            opening: "正在启动终端...",
            probeRunning: "正在通过 PTY 运行 opencode probe...",
            idle: "终端还没启动。",
            running: "运行中",
            closed: "已关闭",
            exitCode: "退出码",
          }
        : {
            title: "Embedded CLI",
            subtitle: "This panel uses a PTY, so it should behave closer to running opencode manually in PowerShell.",
            start: "Start Terminal",
            reconnect: "Reconnect",
            close: "Close Terminal",
            runProbe: "Run Health Probe In Terminal",
            cwd: "Working Directory",
            shell: "Shell",
            status: "Status",
            command: "Command",
            placeholder: "Example: opencode run \"Reply with exactly OK\" --model opencode/qwen3.6-plus-free",
            send: "Send Command",
            interrupt: "Send Ctrl+C",
            opening: "Starting terminal...",
            probeRunning: "Running the opencode probe through a PTY...",
            idle: "The terminal has not been started yet.",
            running: "Running",
            closed: "Closed",
            exitCode: "Exit Code",
          },
    [language],
  );

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!outputRef.current) {
      return;
    }

    outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [session?.output]);

  function attachStream(sessionId: string) {
    eventSourceRef.current?.close();
    const source = new EventSource(`${API_BASE_URL}/terminal/sessions/${sessionId}/events`);
    eventSourceRef.current = source;

    source.onmessage = (event) => {
      const payload = JSON.parse(event.data) as TerminalEvent;

      if (payload.type === "snapshot") {
        setSession(payload.session);
        setError("");
        return;
      }

      if (payload.type === "output" || payload.type === "exit") {
        setSession(payload.session);
        return;
      }

      if (payload.type === "error") {
        setError(payload.message);
      }
    };

    source.onerror = () => {
      source.close();
    };
  }

  async function ensureSession() {
    if (session?.status === "running") {
      return session;
    }

    setConnecting(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE_URL}/terminal/sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cwd: input.rootPath.trim() || undefined,
        }),
      });
      const payload = await parseJsonResponse<{ session?: TerminalSession; error?: string; message?: string }>(response);

      if (!response.ok || !payload.session) {
        throw new Error(readApiError(payload, "Failed to start terminal session"));
      }

      setSession(payload.session);
      attachStream(payload.session.id);
      return payload.session;
    } finally {
      setConnecting(false);
    }
  }

  async function sendCommand(nextCommand: string) {
    const trimmed = nextCommand.trim();

    if (!trimmed) {
      return;
    }

    const active = await ensureSession();

    if (!active) {
      return;
    }

    const response = await fetch(`${API_BASE_URL}/terminal/sessions/${active.id}/run-command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        command: trimmed,
      }),
    });
    const payload = await parseJsonResponse<{ session?: TerminalSession; error?: string; message?: string }>(response);

    if (!response.ok || !payload.session) {
      throw new Error(readApiError(payload, "Failed to send terminal command"));
    }

    setCommand("");
  }

  async function handleStart() {
    try {
      await ensureSession();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to start terminal");
    }
  }

  async function handleClose() {
    if (!session) {
      return;
    }

    eventSourceRef.current?.close();

    try {
      const response = await fetch(`${API_BASE_URL}/terminal/sessions/${session.id}/close`, {
        method: "POST",
      });
      const payload = await parseJsonResponse<{ session?: TerminalSession; error?: string; message?: string }>(response);

      if (!response.ok || !payload.session) {
        throw new Error(readApiError(payload, "Failed to close terminal session"));
      }

      setSession(payload.session);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to close terminal");
    }
  }

  async function handleInterrupt() {
    if (!session) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/terminal/sessions/${session.id}/input`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: "\u0003",
        }),
      });
      const payload = await parseJsonResponse<{ session?: TerminalSession; error?: string; message?: string }>(response);

      if (!response.ok || !payload.session) {
        throw new Error(readApiError(payload, "Failed to send Ctrl+C"));
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to send Ctrl+C");
    }
  }

  async function handleRunProbe() {
    const normalizedModel = input.intakeModel.includes("/")
      ? input.intakeModel
      : `${input.intakeProvider}/${input.intakeModel}`;
    const targetDir = input.rootPath.trim() || ".";

    setRunningProbe(true);
    setError("");

    try {
      await sendCommand(`opencode run "Reply with exactly OK" --model ${normalizedModel} --dir "${targetDir}"`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to run probe in terminal");
    } finally {
      setRunningProbe(false);
    }
  }

  return (
    <section className="preview-panel">
      <h3>{text.title}</h3>
      <div className="mode-hint">{text.subtitle}</div>
      <div className="button-row">
        <button className="button ghost" type="button" onClick={() => void handleStart()} disabled={connecting}>
          {connecting ? text.opening : session ? text.reconnect : text.start}
        </button>
        <button className="button ghost" type="button" onClick={() => void handleRunProbe()} disabled={runningProbe}>
          {runningProbe ? text.probeRunning : text.runProbe}
        </button>
        {session ? (
          <>
            <button className="button ghost" type="button" onClick={() => void handleInterrupt()}>
              {text.interrupt}
            </button>
            <button className="button ghost" type="button" onClick={() => void handleClose()}>
              {text.close}
            </button>
          </>
        ) : null}
      </div>
      <div className="inline-meta">
        <span className={`tag ${session?.status === "running" ? "good" : ""}`}>
          {text.status}: {session?.status === "running" ? text.running : text.closed}
        </span>
        {session ? <span className="tag">{text.cwd}: {session.cwd}</span> : null}
        {session ? <span className="tag">{text.shell}: {session.shell}</span> : null}
        {session && session.exitCode !== null ? <span className="tag">{text.exitCode}: {session.exitCode}</span> : null}
      </div>
      <pre ref={outputRef} className="terminal-output">
        {session?.output || text.idle}
      </pre>
      <div className="field">
        <label htmlFor="embeddedTerminalCommand">{text.command}</label>
        <input
          id="embeddedTerminalCommand"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void sendCommand(command).catch((nextError) => {
                setError(nextError instanceof Error ? nextError.message : "Failed to send terminal command");
              });
            }
          }}
          placeholder={text.placeholder}
        />
      </div>
      <div className="button-row">
        <button
          className="button secondary"
          type="button"
          onClick={() =>
            void sendCommand(command).catch((nextError) => {
              setError(nextError instanceof Error ? nextError.message : "Failed to send terminal command");
            })
          }
        >
          {text.send}
        </button>
      </div>
      {error ? <div className="feedback">{error}</div> : null}
    </section>
  );
}
