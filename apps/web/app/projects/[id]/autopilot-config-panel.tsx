"use client";

import { useEffect, useState } from "react";

import { CLIENT_API_BASE_URL } from "../../../lib/client-api";
import { parseJsonResponse, readApiError } from "../../../lib/http";
import { useLanguage } from "../../language-provider";

const API_BASE_URL = CLIENT_API_BASE_URL;

type AutopilotConfig = {
  id: string;
  projectId: string;
  stopOnHumanGate: boolean;
  stopOnFirstFailure: boolean;
  stopOnConsecutiveFailures: number;
  stopOnBudgetTokens: number | null;
  stopOnBudgetCostCents: number | null;
  stopOnMaxTasks: number | null;
  stopOnMaxTimeMinutes: number | null;
  approvalGateEvery: number | null;
  approvalGateOnHighRisk: boolean;
  autoApproveSafeTasks: boolean;
  autoApproveAfterVerifications: number;
  pauseOnSensitiveFiles: boolean;
  requireReviewOnFiles: string[];
};

function getText(language: "en" | "zh") {
  if (language === "zh") {
    return {
      title: "自动驾驶配置",
      idle: "配置自动驾驶的停止条件和审批规则。",
      saving: "正在保存配置...",
      saved: "配置已保存。",
      saveFailed: "保存失败",
      saveConfig: "保存配置",
      savingShort: "保存中...",
      stopOnHumanGate: "遇人工闸门时停止",
      stopOnHumanGateHint: "如果任务需要人工审批，暂停自动驾驶",
      stopOnFirstFailure: "首次失败时停止",
      stopOnFirstFailureHint: "任何任务失败时立即停止",
      stopOnConsecutiveFailures: "连续失败阈值",
      stopOnConsecutiveFailuresHint: "连续失败超过此数量时停止",
      stopOnMaxTasks: "最大任务数",
      stopOnMaxTasksHint: "完成后停止，留空表示无限制",
      stopOnMaxTimeMinutes: "最大时间（分钟）",
      stopOnMaxTimeMinutesHint: "运行时间超过此值时停止",
      stopOnBudgetTokens: "Token 预算",
      stopOnBudgetTokensHint: "Token 使用超过此值时停止",
      stopOnBudgetCostCents: "成本预算（分）",
      stopOnBudgetCostCentsHint: "成本超过此值时停止，单位：分（100 = $1）",
      approvalGateEvery: "审批间隔",
      approvalGateEveryHint: "每完成 N 个任务后请求审批，留空表示不启用",
      approvalGateOnHighRisk: "高风险文件需审批",
      approvalGateOnHighRiskHint: "涉及数据库、认证、支付等文件时暂停",
      autoApproveSafeTasks: "自动批准安全任务",
      autoApproveSafeTasksHint: "文档和 UI 文本任务通过验证后自动批准",
      autoApproveAfterVerifications: "验证次数要求",
      autoApproveAfterVerificationsHint: "需要多少次验证通过才能自动批准",
      pauseOnSensitiveFiles: "敏感文件暂停",
      pauseOnSensitiveFilesHint: "修改敏感文件时暂停等待审批",
      requireReviewOnFiles: "需审查的文件模式",
      requireReviewOnFilesHint: "匹配这些模式的文件需要审查，每行一个正则表达式",
      unlimited: "无限制",
      numberOnly: "请输入数字",
    };
  }

  return {
    title: "Autopilot Configuration",
    idle: "Configure stop conditions and approval rules for autopilot.",
    saving: "Saving configuration...",
    saved: "Configuration saved.",
    saveFailed: "Failed to save configuration",
    saveConfig: "Save Config",
    savingShort: "Saving...",
    stopOnHumanGate: "Stop on Human Gate",
    stopOnHumanGateHint: "Pause autopilot when a task needs human approval",
    stopOnFirstFailure: "Stop on First Failure",
    stopOnFirstFailureHint: "Stop immediately when any task fails",
    stopOnConsecutiveFailures: "Consecutive Failures Threshold",
    stopOnConsecutiveFailuresHint: "Stop when consecutive failures exceed this number",
    stopOnMaxTasks: "Maximum Tasks",
    stopOnMaxTasksHint: "Stop after completing this many tasks, leave empty for unlimited",
    stopOnMaxTimeMinutes: "Maximum Time (minutes)",
    stopOnMaxTimeMinutesHint: "Stop when running time exceeds this value",
    stopOnBudgetTokens: "Token Budget",
    stopOnBudgetTokensHint: "Stop when token usage exceeds this value",
    stopOnBudgetCostCents: "Cost Budget (cents)",
    stopOnBudgetCostCentsHint: "Stop when cost exceeds this value (100 = $1)",
    approvalGateEvery: "Approval Gate Interval",
    approvalGateEveryHint: "Request approval after every N completed tasks, leave empty to disable",
    approvalGateOnHighRisk: "Require Approval for High-Risk Files",
    approvalGateOnHighRiskHint: "Pause when touching database, auth, payment, etc.",
    autoApproveSafeTasks: "Auto-Approve Safe Tasks",
    autoApproveSafeTasksHint: "Automatically approve documentation and UI text tasks after verification",
    autoApproveAfterVerifications: "Verification Count Requirement",
    autoApproveAfterVerificationsHint: "Number of successful verifications needed for auto-approval",
    pauseOnSensitiveFiles: "Pause on Sensitive Files",
    pauseOnSensitiveFilesHint: "Pause for approval when modifying sensitive files",
    requireReviewOnFiles: "File Patterns Requiring Review",
    requireReviewOnFilesHint: "Files matching these patterns require review, one regex per line",
    unlimited: "Unlimited",
    numberOnly: "Please enter a number",
  };
}

export function AutopilotConfigPanel({ projectId }: { projectId: string }) {
  const { language } = useLanguage();
  const text = getText(language);
  const [config, setConfig] = useState<AutopilotConfig | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(text.idle);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function loadConfig() {
      try {
        const response = await fetch(`${API_BASE_URL}/projects/${projectId}/autopilot-config`);
        const payload = await parseJsonResponse<{ config: AutopilotConfig }>(response);
        setConfig(payload.config);
        setLoaded(true);
      } catch {
        setMessage(text.saveFailed);
      }
    }
    loadConfig();
  }, [projectId, text.saveFailed]);

  useEffect(() => {
    if (loaded) {
      setMessage(text.idle);
    }
  }, [loaded, text.idle]);

  function updateConfig<K extends keyof AutopilotConfig>(key: K, value: AutopilotConfig[K]) {
    setConfig((current) => (current ? { ...current, [key]: value } : null));
  }

  function parseNumberInput(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = parseInt(trimmed, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  async function saveConfig() {
    if (!config) return;
    setPending(true);
    setMessage(text.saving);

    try {
      const response = await fetch(`${API_BASE_URL}/projects/${projectId}/autopilot-config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stopOnHumanGate: config.stopOnHumanGate,
          stopOnFirstFailure: config.stopOnFirstFailure,
          stopOnConsecutiveFailures: config.stopOnConsecutiveFailures,
          stopOnBudgetTokens: config.stopOnBudgetTokens,
          stopOnBudgetCostCents: config.stopOnBudgetCostCents,
          stopOnMaxTasks: config.stopOnMaxTasks,
          stopOnMaxTimeMinutes: config.stopOnMaxTimeMinutes,
          approvalGateEvery: config.approvalGateEvery,
          approvalGateOnHighRisk: config.approvalGateOnHighRisk,
          autoApproveSafeTasks: config.autoApproveSafeTasks,
          autoApproveAfterVerifications: config.autoApproveAfterVerifications,
          pauseOnSensitiveFiles: config.pauseOnSensitiveFiles,
          requireReviewOnFiles: config.requireReviewOnFiles,
        }),
      });
      const payload = await parseJsonResponse<{ config: AutopilotConfig; error?: string }>(response);

      if (!response.ok) {
        throw new Error(readApiError(payload, text.saveFailed));
      }

      setConfig(payload.config);
      setMessage(text.saved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text.saveFailed);
    } finally {
      setPending(false);
    }
  }

  if (!config) {
    return <div className="feedback">{text.saving}</div>;
  }

  return (
    <div className="stack">
      <h3>{text.title}</h3>
      <div className="feedback">{message}</div>

      <div className="grid-2">
        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={config.stopOnHumanGate}
              onChange={(e) => updateConfig("stopOnHumanGate", e.target.checked)}
            />
            <span> {text.stopOnHumanGate}</span>
          </label>
          <div className="muted">{text.stopOnHumanGateHint}</div>
        </div>

        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={config.stopOnFirstFailure}
              onChange={(e) => updateConfig("stopOnFirstFailure", e.target.checked)}
            />
            <span> {text.stopOnFirstFailure}</span>
          </label>
          <div className="muted">{text.stopOnFirstFailureHint}</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="field">
          <label>{text.stopOnConsecutiveFailures}</label>
          <input
            type="number"
            min={1}
            value={config.stopOnConsecutiveFailures}
            onChange={(e) => updateConfig("stopOnConsecutiveFailures", Math.max(1, parseInt(e.target.value, 10) || 1))}
          />
          <div className="muted">{text.stopOnConsecutiveFailuresHint}</div>
        </div>

        <div className="field">
          <label>{text.stopOnMaxTasks}</label>
          <input
            type="number"
            min={1}
            placeholder={text.unlimited}
            value={config.stopOnMaxTasks ?? ""}
            onChange={(e) => updateConfig("stopOnMaxTasks", parseNumberInput(e.target.value))}
          />
          <div className="muted">{text.stopOnMaxTasksHint}</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="field">
          <label>{text.stopOnMaxTimeMinutes}</label>
          <input
            type="number"
            min={1}
            placeholder={text.unlimited}
            value={config.stopOnMaxTimeMinutes ?? ""}
            onChange={(e) => updateConfig("stopOnMaxTimeMinutes", parseNumberInput(e.target.value))}
          />
          <div className="muted">{text.stopOnMaxTimeMinutesHint}</div>
        </div>

        <div className="field">
          <label>{text.approvalGateEvery}</label>
          <input
            type="number"
            min={1}
            placeholder={text.unlimited}
            value={config.approvalGateEvery ?? ""}
            onChange={(e) => updateConfig("approvalGateEvery", parseNumberInput(e.target.value))}
          />
          <div className="muted">{text.approvalGateEveryHint}</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="field">
          <label>{text.stopOnBudgetTokens}</label>
          <input
            type="number"
            min={1}
            placeholder={text.unlimited}
            value={config.stopOnBudgetTokens ?? ""}
            onChange={(e) => updateConfig("stopOnBudgetTokens", parseNumberInput(e.target.value))}
          />
          <div className="muted">{text.stopOnBudgetTokensHint}</div>
        </div>

        <div className="field">
          <label>{text.stopOnBudgetCostCents}</label>
          <input
            type="number"
            min={1}
            placeholder={text.unlimited}
            value={config.stopOnBudgetCostCents ?? ""}
            onChange={(e) => updateConfig("stopOnBudgetCostCents", parseNumberInput(e.target.value))}
          />
          <div className="muted">{text.stopOnBudgetCostCentsHint}</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={config.approvalGateOnHighRisk}
              onChange={(e) => updateConfig("approvalGateOnHighRisk", e.target.checked)}
            />
            <span> {text.approvalGateOnHighRisk}</span>
          </label>
          <div className="muted">{text.approvalGateOnHighRiskHint}</div>
        </div>

        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={config.autoApproveSafeTasks}
              onChange={(e) => updateConfig("autoApproveSafeTasks", e.target.checked)}
            />
            <span> {text.autoApproveSafeTasks}</span>
          </label>
          <div className="muted">{text.autoApproveSafeTasksHint}</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="field">
          <label>{text.autoApproveAfterVerifications}</label>
          <input
            type="number"
            min={1}
            value={config.autoApproveAfterVerifications}
            onChange={(e) => updateConfig("autoApproveAfterVerifications", Math.max(1, parseInt(e.target.value, 10) || 1))}
          />
          <div className="muted">{text.autoApproveAfterVerificationsHint}</div>
        </div>

        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={config.pauseOnSensitiveFiles}
              onChange={(e) => updateConfig("pauseOnSensitiveFiles", e.target.checked)}
            />
            <span> {text.pauseOnSensitiveFiles}</span>
          </label>
          <div className="muted">{text.pauseOnSensitiveFilesHint}</div>
        </div>
      </div>

      <div className="field">
        <label>{text.requireReviewOnFiles}</label>
        <textarea
          value={config.requireReviewOnFiles.join("\n")}
          onChange={(e) =>
            updateConfig(
              "requireReviewOnFiles",
              e.target.value.split(/\r?\n/).filter(Boolean),
            )
          }
          placeholder={text.requireReviewOnFilesHint}
        />
      </div>

      <div className="button-row">
        <button className="button secondary" type="button" onClick={saveConfig} disabled={pending}>
          {pending ? text.savingShort : text.saveConfig}
        </button>
      </div>
    </div>
  );
}
