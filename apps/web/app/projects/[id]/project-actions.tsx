"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { CLIENT_API_BASE_URL } from "../../../lib/client-api";
import { parseJsonResponse, readApiError } from "../../../lib/http";
import { useLanguage } from "../../language-provider";

const API_BASE_URL = CLIENT_API_BASE_URL;

type PendingAction = "start" | "reparse" | "autopilot-start" | "autopilot-stop" | null;

function getText(language: "en" | "zh") {
  if (language === "zh") {
    return {
      idle: "可以在这里重新解析 Markdown 任务，单步推进下一个任务，或启动连续自动执行。",
      selecting: "正在把下一个可运行任务加入后台执行...",
      advanced: "项目执行已加入后台队列。请查看实时活动或稍后刷新。",
      startFailed: "启动下一个任务失败",
      reparsing: "正在重新解析 TODO Markdown...",
      reparsed: "任务列表已重新解析。",
      reparseFailed: "重新解析任务失败",
      runNextPending: "加入中...",
      runNext: "运行下一个任务",
      processing: "处理中...",
      reparse: "重新解析任务",
      refresh: "刷新",
      autopilotStarting: "正在启动自动驾驶...",
      autopilotStarted: "自动驾驶已启动。ForgeFlow 会持续拉取后续任务，直到遇到失败、人工闸门或你主动停止。",
      autopilotStartFailed: "启动自动驾驶失败",
      autopilotStopping: "正在停止自动驾驶...",
      autopilotStopped: "自动驾驶已停止。",
      autopilotStopFailed: "停止自动驾驶失败",
      autopilotStart: "启动自动驾驶",
      autopilotStop: "停止自动驾驶",
      autopilotBadgeOn: "自动驾驶开启",
      autopilotBadgeOff: "自动驾驶关闭",
    };
  }

  return {
    idle: "Reparse Markdown tasks, queue the next runnable task, or let ForgeFlow keep pulling work automatically.",
    selecting: "Queueing the next runnable task...",
    advanced: "Project execution was queued in the background. Check Live Activity or refresh shortly.",
    startFailed: "Failed to start the next task",
    reparsing: "Reparsing TODO Markdown...",
    reparsed: "Task list reparsed.",
    reparseFailed: "Failed to reparse tasks",
    runNextPending: "Queueing...",
    runNext: "Run Next Task",
    processing: "Processing...",
    reparse: "Reparse Tasks",
    refresh: "Refresh",
    autopilotStarting: "Starting autopilot...",
    autopilotStarted:
      "Autopilot started. ForgeFlow will keep pulling runnable tasks until it hits a failure, a human gate, or a stop request.",
    autopilotStartFailed: "Failed to start autopilot",
    autopilotStopping: "Stopping autopilot...",
    autopilotStopped: "Autopilot stopped.",
    autopilotStopFailed: "Failed to stop autopilot",
    autopilotStart: "Start Autopilot",
    autopilotStop: "Stop Autopilot",
    autopilotBadgeOn: "Autopilot on",
    autopilotBadgeOff: "Autopilot off",
  };
}

export function ProjectActions({
  projectId,
  autoRunEnabled,
}: {
  projectId: string;
  autoRunEnabled: boolean;
}) {
  const { language } = useLanguage();
  const router = useRouter();
  const text = getText(language);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [message, setMessage] = useState(text.idle);

  useEffect(() => {
    setMessage(text.idle);
  }, [text.idle]);

  async function post(path: string) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
    });

    const payload = await parseJsonResponse<{ accepted?: boolean; message?: string; error?: string }>(response);

    if (!response.ok) {
      throw new Error(readApiError(payload, "Request failed"));
    }

    return payload;
  }

  async function handleStart() {
    setPendingAction("start");
    setMessage(text.selecting);

    try {
      const payload = await post(`/projects/${projectId}/start`);
      setMessage(payload.message ?? text.advanced);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text.startFailed);
    } finally {
      setPendingAction(null);
    }
  }

  async function handleReparse() {
    setPendingAction("reparse");
    setMessage(text.reparsing);

    try {
      await post(`/projects/${projectId}/reparse`);
      setMessage(text.reparsed);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text.reparseFailed);
    } finally {
      setPendingAction(null);
    }
  }

  async function handleAutopilotStart() {
    setPendingAction("autopilot-start");
    setMessage(text.autopilotStarting);

    try {
      const payload = await post(`/projects/${projectId}/autopilot/start`);
      setMessage(payload.message ?? text.autopilotStarted);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text.autopilotStartFailed);
    } finally {
      setPendingAction(null);
    }
  }

  async function handleAutopilotStop() {
    setPendingAction("autopilot-stop");
    setMessage(text.autopilotStopping);

    try {
      const payload = await post(`/projects/${projectId}/autopilot/stop`);
      setMessage(payload.message ?? text.autopilotStopped);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text.autopilotStopFailed);
    } finally {
      setPendingAction(null);
    }
  }

  const autopilotBusy = pendingAction === "autopilot-start" || pendingAction === "autopilot-stop";

  return (
    <div className="stack">
      <div className="inline-meta">
        <span className={`tag ${autoRunEnabled ? "good" : "warn"}`}>
          {autoRunEnabled ? text.autopilotBadgeOn : text.autopilotBadgeOff}
        </span>
      </div>
      <div className="feedback">{message}</div>
      <div className="button-row">
        <button className="button" type="button" onClick={handleStart} disabled={pendingAction !== null}>
          {pendingAction === "start" ? text.runNextPending : text.runNext}
        </button>
        <button className="button secondary" type="button" onClick={handleReparse} disabled={pendingAction !== null}>
          {pendingAction === "reparse" ? text.processing : text.reparse}
        </button>
        {autoRunEnabled ? (
          <button className="button secondary" type="button" onClick={handleAutopilotStop} disabled={pendingAction !== null}>
            {autopilotBusy ? text.processing : text.autopilotStop}
          </button>
        ) : (
          <button className="button" type="button" onClick={handleAutopilotStart} disabled={pendingAction !== null}>
            {autopilotBusy ? text.processing : text.autopilotStart}
          </button>
        )}
        <button className="button ghost" type="button" onClick={() => router.refresh()} disabled={pendingAction !== null}>
          {text.refresh}
        </button>
      </div>
    </div>
  );
}
