"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { CLIENT_API_BASE_URL } from "../../../lib/client-api";
import { parseJsonResponse, readApiError } from "../../../lib/http";
import { useLanguage } from "../../language-provider";

const API_BASE_URL = CLIENT_API_BASE_URL;

export function ProjectActions({ projectId }: { projectId: string }) {
  const { language } = useLanguage();
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<"start" | "reparse" | null>(null);
  const text =
    language === "zh"
      ? {
          idle: "可以在这里重新解析 Markdown 任务，或推进下一个可运行任务。",
          selecting: "正在选择下一个可运行任务...",
          advanced: "项目执行已向前推进一步，正在刷新页面。",
          startFailed: "启动下一个任务失败",
          reparsing: "正在重新解析 TODO Markdown...",
          reparsed: "任务列表已重新解析。",
          reparseFailed: "重新解析任务失败",
          running: "运行中...",
          runNext: "运行下一个任务",
          processing: "处理中...",
          reparse: "重新解析任务",
          refresh: "刷新",
        }
      : {
          idle: "Reparse Markdown tasks or advance the next runnable task.",
          selecting: "Selecting the next runnable task...",
          advanced: "Project execution advanced one step. Refreshing the page.",
          startFailed: "Failed to start the next task",
          reparsing: "Reparsing TODO Markdown...",
          reparsed: "Task list reparsed.",
          reparseFailed: "Failed to reparse tasks",
          running: "Running...",
          runNext: "Run Next Task",
          processing: "Processing...",
          reparse: "Reparse Tasks",
          refresh: "Refresh",
        };
  const [message, setMessage] = useState(text.idle);

  async function post(path: string) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
    });

    const payload = await parseJsonResponse<{ error?: string; message?: string }>(response);

    if (!response.ok) {
      throw new Error(readApiError(payload, "Request failed"));
    }
  }

  async function handleStart() {
    setPendingAction("start");
    setMessage(text.selecting);

    try {
      await post(`/projects/${projectId}/start`);
      setMessage(text.advanced);
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

  return (
    <div className="stack">
      <div className="feedback">{message}</div>
      <div className="button-row">
        <button className="button" type="button" onClick={handleStart} disabled={pendingAction !== null}>
          {pendingAction === "start" ? text.running : text.runNext}
        </button>
        <button className="button secondary" type="button" onClick={handleReparse} disabled={pendingAction !== null}>
          {pendingAction === "reparse" ? text.processing : text.reparse}
        </button>
        <button className="button ghost" type="button" onClick={() => router.refresh()} disabled={pendingAction !== null}>
          {text.refresh}
        </button>
      </div>
    </div>
  );
}
