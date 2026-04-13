"use client";

import { useEffect, useState } from "react";

import { CLIENT_API_BASE_URL } from "../../../lib/client-api";
import { parseJsonResponse, readApiError } from "../../../lib/http";
import { useLanguage } from "../../language-provider";

const API_BASE_URL = CLIENT_API_BASE_URL;

type AutopilotSession = {
  id: string;
  projectId: string;
  configId: string;
  status: string;
  tasksCompleted: number;
  tasksFailed: number;
  consecutiveFailures: number;
  tokensUsed: number;
  costCents: number;
  approvalsGranted: number;
  pendingApproval: boolean;
  stopReason: string | null;
  startedAt: string;
  endedAt: string | null;
};

function getText(language: "en" | "zh") {
  if (language === "zh") {
    return {
      sessionTitle: "自动驾驶会话",
      status: "状态",
      statusRunning: "运行中",
      statusPaused: "已暂停",
      statusCompleted: "已完成",
      tasksCompleted: "已完成任务",
      tasksFailed: "失败任务",
      tokensUsed: "Token 使用",
      costCents: "成本",
      duration: "运行时长",
      pendingApproval: "等待审批",
      stopReason: "停止原因",
      approveContinuation: "批准继续",
      approving: "批准中...",
      approved: "已批准",
      approveFailed: "批准失败",
      noActiveSession: "暂无活动会话",
      approvalGateReached: "审批闸门触发",
      highRiskFiles: "高风险文件",
      sensitiveFiles: "敏感文件",
    };
  }

  return {
    sessionTitle: "Autopilot Session",
    status: "Status",
    statusRunning: "Running",
    statusPaused: "Paused",
    statusCompleted: "Completed",
    tasksCompleted: "Tasks Completed",
    tasksFailed: "Tasks Failed",
    tokensUsed: "Tokens Used",
    costCents: "Cost",
    duration: "Duration",
    pendingApproval: "Pending Approval",
    stopReason: "Stop Reason",
    approveContinuation: "Approve Continuation",
    approving: "Approving...",
    approved: "Approved",
    approveFailed: "Failed to approve",
    noActiveSession: "No active session",
    approvalGateReached: "Approval gate reached",
    highRiskFiles: "High-risk files",
    sensitiveFiles: "Sensitive files",
  };
}

function formatDuration(startedAt: string, endedAt: string | null): string {
  const start = new Date(startedAt);
  const end = endedAt ? new Date(endedAt) : new Date();
  const diffMs = end.getTime() - start.getTime();
  const minutes = Math.floor(diffMs / 60000);
  const seconds = Math.floor((diffMs % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatCost(costCents: number): string {
  return `$${(costCents / 100).toFixed(2)}`;
}

export function AutopilotSessionStatus({ projectId }: { projectId: string }) {
  const { language } = useLanguage();
  const text = getText(language);
  const [session, setSession] = useState<AutopilotSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [message, setMessage] = useState("");

  async function loadSession() {
    try {
      const response = await fetch(`${API_BASE_URL}/projects/${projectId}/autopilot-session`);
      const payload = await parseJsonResponse<{ session: AutopilotSession | null }>(response);
      setSession(payload.session);
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSession();
    const interval = setInterval(loadSession, 5000);
    return () => clearInterval(interval);
  }, [projectId]);

  async function handleApproveContinuation() {
    if (!session) return;
    setApproving(true);
    setMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/autopilot-sessions/${session.id}/approve-continuation`, {
        method: "POST",
      });
      const payload = await parseJsonResponse<{ session?: AutopilotSession; error?: string }>(response);

      if (!response.ok) {
        throw new Error(readApiError(payload, text.approveFailed));
      }

      setMessage(text.approved);
      setSession(payload.session ?? null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text.approveFailed);
    } finally {
      setApproving(false);
    }
  }

  if (loading) {
    return null;
  }

  if (!session) {
    return null;
  }

  const statusLabel = session.status === "running"
    ? text.statusRunning
    : session.status === "paused"
      ? text.statusPaused
      : text.statusCompleted;

  const statusClass = session.status === "running"
    ? "good"
    : session.status === "paused"
      ? "warn"
      : "muted";

  return (
    <div className="stack">
      <h4>{text.sessionTitle}</h4>
      <div className="inline-meta">
        <span className={`tag ${statusClass}`}>
          {text.status}: {statusLabel}
        </span>
      </div>
      <div className="grid-2">
        <div className="stat">
          <span className="label">{text.tasksCompleted}</span>
          <span className="value">{session.tasksCompleted}</span>
        </div>
        <div className="stat">
          <span className="label">{text.tasksFailed}</span>
          <span className="value">{session.tasksFailed}</span>
        </div>
        <div className="stat">
          <span className="label">{text.tokensUsed}</span>
          <span className="value">{session.tokensUsed.toLocaleString()}</span>
        </div>
        <div className="stat">
          <span className="label">{text.costCents}</span>
          <span className="value">{formatCost(session.costCents)}</span>
        </div>
        <div className="stat">
          <span className="label">{text.duration}</span>
          <span className="value">{formatDuration(session.startedAt, session.endedAt)}</span>
        </div>
      </div>
      {session.stopReason && (
        <div className="feedback warn">
          {text.stopReason}: {session.stopReason}
        </div>
      )}
      {session.pendingApproval && (
        <div className="stack">
          <div className="feedback warn">{text.pendingApproval}</div>
          {message && <div className="feedback">{message}</div>}
          <button
            className="button"
            type="button"
            onClick={handleApproveContinuation}
            disabled={approving}
          >
            {approving ? text.approving : text.approveContinuation}
          </button>
        </div>
      )}
    </div>
  );
}
