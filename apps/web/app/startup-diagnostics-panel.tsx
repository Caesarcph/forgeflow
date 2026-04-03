"use client";

import { useState } from "react";

import { CLIENT_API_BASE_URL } from "../lib/client-api";
import { parseJsonResponse } from "../lib/http";
import { formatDateTime } from "../lib/i18n";
import type { StartupDiagnosticsReport } from "../lib/api";
import { useLanguage } from "./language-provider";

type Props = {
  initialDiagnostics: StartupDiagnosticsReport | null;
};

function overallTagClass(status: "pass" | "warn" | "fail") {
  if (status === "pass") {
    return "tag good";
  }

  if (status === "fail") {
    return "tag bad";
  }

  return "tag warn";
}

export function StartupDiagnosticsPanel({ initialDiagnostics }: Props) {
  const { language } = useLanguage();
  const [diagnostics, setDiagnostics] = useState(initialDiagnostics);
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(false);
  const text =
    language === "zh"
      ? {
          title: "首次启动诊断",
          description: "在导入项目之前，先检查数据库、环境变量、API 连接和 OpenCode CLI 是否可用。",
          refreshing: "刷新中...",
          refresh: "刷新诊断",
          refreshFailed: "刷新启动诊断失败。",
          refreshed: "诊断已刷新。",
          unavailable: "当前无法获取启动诊断。",
          passed: "通过",
          warned: "警告",
          failed: "失败",
        }
      : {
          title: "First-Run Diagnostics",
          description:
            "Check database connectivity, local environment configuration, API reachability, and OpenCode CLI readiness before importing projects.",
          refreshing: "Refreshing...",
          refresh: "Refresh Diagnostics",
          refreshFailed: "Failed to refresh startup diagnostics.",
          refreshed: "Diagnostics refreshed.",
          unavailable: "Startup diagnostics are unavailable right now.",
          passed: "passed",
          warned: "warned",
          failed: "failed",
        };

  async function refreshDiagnostics() {
    setLoading(true);
    setFeedback("");

    try {
      const response = await fetch(`${CLIENT_API_BASE_URL}/diagnostics/startup`, {
        cache: "no-store",
      });
      const payload = await parseJsonResponse<{ diagnostics: StartupDiagnosticsReport }>(response);

      if (!response.ok) {
        throw new Error(text.refreshFailed);
      }

      setDiagnostics(payload.diagnostics);
      setFeedback(text.refreshed);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : text.refreshFailed);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="table-panel">
      <div className="panel-title-row">
        <div>
          <h2>{text.title}</h2>
          <p className="muted">{text.description}</p>
        </div>

        <div className="button-row">
          <button type="button" className="button secondary" onClick={refreshDiagnostics} disabled={loading}>
            {loading ? text.refreshing : text.refresh}
          </button>
        </div>
      </div>

      {!diagnostics ? (
        <div className="empty">{text.unavailable}</div>
      ) : (
        <div className="diagnostics-grid">
          <div className="diagnostics-summary">
            <div className="inline-meta">
              <span className={overallTagClass(diagnostics.overallStatus)}>{diagnostics.overallStatus}</span>
              <span className="tag">{formatDateTime(diagnostics.checkedAt)}</span>
            </div>
            <div className="muted">
              {diagnostics.checks.filter((check) => check.status === "pass").length} {text.passed} /{" "}
              {diagnostics.checks.filter((check) => check.status === "warn").length} {text.warned} /{" "}
              {diagnostics.checks.filter((check) => check.status === "fail").length} {text.failed}
            </div>
          </div>

          <div className="diagnostics-list">
            {diagnostics.checks.map((check) => (
              <div key={check.id} className="diagnostic-item">
                <div className="inline-meta">
                  <strong>{check.label}</strong>
                  <span className={overallTagClass(check.status)}>{check.status}</span>
                </div>
                <div className="muted">{check.summary}</div>
                {check.details ? (
                  <pre className="code-block compact-code">{JSON.stringify(check.details, null, 2)}</pre>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="feedback">{feedback}</div>
    </section>
  );
}
