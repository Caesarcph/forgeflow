"use client";

import { useEffect, useState } from "react";

import { CLIENT_API_BASE_URL } from "../../../lib/client-api";
import { parseJsonResponse, readApiError } from "../../../lib/http";
import { useLanguage } from "../../language-provider";

const API_BASE_URL = CLIENT_API_BASE_URL;

type ExecutionBudget = {
  id: string;
  projectId: string;
  maxTimeMinutes: number | null;
  maxRetries: number;
  maxCommands: number | null;
  maxModelCalls: number | null;
};

function getText(language: "en" | "zh") {
  if (language === "zh") {
    return {
      idle: "配置每个任务执行的预算限制。",
      saving: "正在保存配置...",
      saved: "配置已保存。",
      saveFailed: "保存失败",
      saveConfig: "保存配置",
      savingShort: "保存中...",
      maxTimeMinutes: "最大时间（分钟）",
      maxTimeMinutesHint: "单个任务执行的最大时间，留空表示无限制",
      maxRetries: "最大重试次数",
      maxRetriesHint: "阶段失败时允许的重试次数，0 表示不限制",
      maxCommands: "最大命令数",
      maxCommandsHint: "单个任务执行的最大 shell 命令数，留空表示无限制",
      maxModelCalls: "最大模型调用数",
      maxModelCallsHint: "单个任务执行的最大模型调用次数，留空表示无限制",
      unlimited: "无限制",
    };
  }

  return {
    idle: "Configure budget limits for each task execution.",
    saving: "Saving configuration...",
    saved: "Configuration saved.",
    saveFailed: "Failed to save configuration",
    saveConfig: "Save Config",
    savingShort: "Saving...",
    maxTimeMinutes: "Maximum Time (minutes)",
    maxTimeMinutesHint: "Maximum execution time per task; leave empty for unlimited",
    maxRetries: "Maximum Retries",
    maxRetriesHint: "Retries allowed after stage failures; 0 means unlimited",
    maxCommands: "Maximum Commands",
    maxCommandsHint: "Maximum shell commands per task execution; leave empty for unlimited",
    maxModelCalls: "Maximum Model Calls",
    maxModelCallsHint: "Maximum model invocations per task execution; leave empty for unlimited",
    unlimited: "Unlimited",
  };
}

export function ExecutionBudgetPanel({
  projectId,
  initialBudget = null,
}: {
  projectId: string;
  initialBudget?: ExecutionBudget | null;
}) {
  const { language } = useLanguage();
  const text = getText(language);
  const [budget, setBudget] = useState<ExecutionBudget | null>(initialBudget);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(text.idle);

  useEffect(() => {
    async function loadBudget() {
      try {
        const response = await fetch(`${API_BASE_URL}/projects/${projectId}/execution-budget`);
        const payload = await parseJsonResponse<{ budget: ExecutionBudget }>(response);
        setBudget(payload.budget);
        setMessage(text.idle);
      } catch {
        setMessage(text.saveFailed);
      }
    }

    void loadBudget();
  }, [projectId, text.idle, text.saveFailed]);

  function parseNullableInt(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number.parseInt(trimmed, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  function updateBudget<K extends keyof ExecutionBudget>(key: K, value: ExecutionBudget[K]) {
    setBudget((current) => (current ? { ...current, [key]: value } : null));
  }

  async function saveBudget() {
    if (!budget) {
      return;
    }

    setPending(true);
    setMessage(text.saving);

    try {
      const response = await fetch(`${API_BASE_URL}/projects/${projectId}/execution-budget`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maxTimeMinutes: budget.maxTimeMinutes,
          maxRetries: budget.maxRetries,
          maxCommands: budget.maxCommands,
          maxModelCalls: budget.maxModelCalls,
        }),
      });
      const payload = await parseJsonResponse<{ budget: ExecutionBudget; error?: string }>(response);

      if (!response.ok) {
        throw new Error(readApiError(payload, text.saveFailed));
      }

      setBudget(payload.budget);
      setMessage(text.saved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text.saveFailed);
    } finally {
      setPending(false);
    }
  }

  if (!budget) {
    return <div className="feedback">{text.saving}</div>;
  }

  return (
    <div className="stack">
      <div className="feedback">{message}</div>

      <div className="grid-2">
        <div className="field">
          <label>{text.maxTimeMinutes}</label>
          <input
            type="number"
            min={1}
            placeholder={text.unlimited}
            value={budget.maxTimeMinutes ?? ""}
            onChange={(event) => updateBudget("maxTimeMinutes", parseNullableInt(event.target.value))}
          />
          <div className="muted">{text.maxTimeMinutesHint}</div>
        </div>

        <div className="field">
          <label>{text.maxRetries}</label>
          <input
            type="number"
            min={0}
            value={budget.maxRetries}
            onChange={(event) => updateBudget("maxRetries", Math.max(0, Number.parseInt(event.target.value, 10) || 0))}
          />
          <div className="muted">{text.maxRetriesHint}</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="field">
          <label>{text.maxCommands}</label>
          <input
            type="number"
            min={1}
            placeholder={text.unlimited}
            value={budget.maxCommands ?? ""}
            onChange={(event) => updateBudget("maxCommands", parseNullableInt(event.target.value))}
          />
          <div className="muted">{text.maxCommandsHint}</div>
        </div>

        <div className="field">
          <label>{text.maxModelCalls}</label>
          <input
            type="number"
            min={1}
            placeholder={text.unlimited}
            value={budget.maxModelCalls ?? ""}
            onChange={(event) => updateBudget("maxModelCalls", parseNullableInt(event.target.value))}
          />
          <div className="muted">{text.maxModelCallsHint}</div>
        </div>
      </div>

      <div className="button-row">
        <button className="button secondary" type="button" onClick={saveBudget} disabled={pending}>
          {pending ? text.savingShort : text.saveConfig}
        </button>
      </div>
    </div>
  );
}
