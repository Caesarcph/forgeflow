"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { AgentConfig } from "../../../lib/api";
import { CLIENT_API_BASE_URL } from "../../../lib/client-api";
import { parseJsonResponse, readApiError } from "../../../lib/http";
import { PROVIDER_PRESETS, getDefaultModelForProvider, getProviderModels } from "../../../lib/model-presets";
import { useLanguage } from "../../language-provider";

const API_BASE_URL = CLIENT_API_BASE_URL;
const MIN_TEMPERATURE = 0;
const MAX_TEMPERATURE = 2;

interface DraftAgentConfig {
  enabled: boolean;
  provider: string;
  model: string;
  fallbackModel: string;
  temperature: string;
  maxTokens: string;
  canWriteFiles: boolean;
  canRunCommands: boolean;
}

function toDraft(agent: AgentConfig): DraftAgentConfig {
  return {
    enabled: agent.enabled,
    provider: agent.provider,
    model: agent.model,
    fallbackModel: agent.fallbackModel ?? "",
    temperature: String(agent.temperature),
    maxTokens: String(agent.maxTokens),
    canWriteFiles: agent.canWriteFiles,
    canRunCommands: agent.canRunCommands,
  };
}

function getText(language: "en" | "zh") {
  if (language === "zh") {
    return {
      idle: "可以在这里修改 provider、model、fallback 和执行权限。",
      saving: (roleName: string) => `正在保存 ${roleName} 配置...`,
      saved: (roleName: string) => `${roleName} 配置已保存。`,
      saveFailed: "保存 Agent 配置失败",
      current: "当前",
      presetProvider: "预设 Provider",
      presetModel: "预设 Model",
      customModel: "自定义模型 ID",
      provider: "Provider",
      model: "Model",
      fallback: "Fallback",
      optional: "可选",
      temperatureMaxTokens: "Temperature / Max Tokens",
      limits: `Temperature ${MIN_TEMPERATURE}-${MAX_TEMPERATURE}，Max Tokens 必须是正整数`,
      providerRequired: "Provider 不能为空",
      modelRequired: "Model 不能为空",
      temperatureHint: `Temperature 必须在 ${MIN_TEMPERATURE}-${MAX_TEMPERATURE} 之间`,
      maxTokensHint: "Max Tokens 必须是正整数",
      enabled: "启用",
      writeFiles: "允许写文件",
      runCommands: "允许跑命令",
      savingShort: "保存中...",
      saveConfig: "保存配置",
    };
  }

  return {
    idle: "Change provider, model, fallback, and execution permissions here.",
    saving: (roleName: string) => `Saving ${roleName} settings...`,
    saved: (roleName: string) => `${roleName} settings saved.`,
    saveFailed: "Failed to save agent config",
    current: "Current",
    presetProvider: "Preset Provider",
    presetModel: "Preset Model",
    customModel: "Custom model id",
    provider: "Provider",
    model: "Model",
    fallback: "Fallback",
    optional: "Optional",
    temperatureMaxTokens: "Temperature / Max Tokens",
    limits: `Temperature ${MIN_TEMPERATURE}-${MAX_TEMPERATURE}, Max Tokens must be a positive integer`,
    providerRequired: "Provider is required",
    modelRequired: "Model is required",
    temperatureHint: `Temperature must be between ${MIN_TEMPERATURE} and ${MAX_TEMPERATURE}`,
    maxTokensHint: "Max Tokens must be a positive integer",
    enabled: "enabled",
    writeFiles: "write files",
    runCommands: "run commands",
    savingShort: "Saving...",
    saveConfig: "Save Config",
  };
}

export function AgentConfigPanel({ projectId, agents }: { projectId: string; agents: AgentConfig[] }) {
  const { language } = useLanguage();
  const router = useRouter();
  const text = getText(language);
  const [savedAgents, setSavedAgents] = useState<Record<string, AgentConfig>>(
    Object.fromEntries(agents.map((agent) => [agent.roleName, agent])),
  );
  const [drafts, setDrafts] = useState<Record<string, DraftAgentConfig>>(
    Object.fromEntries(agents.map((agent) => [agent.roleName, toDraft(agent)])),
  );
  const [pendingRole, setPendingRole] = useState<string | null>(null);
  const [message, setMessage] = useState(text.idle);

  useEffect(() => {
    setSavedAgents(Object.fromEntries(agents.map((agent) => [agent.roleName, agent])));
    setDrafts(Object.fromEntries(agents.map((agent) => [agent.roleName, toDraft(agent)])));
  }, [agents]);

  useEffect(() => {
    setMessage(text.idle);
  }, [text.idle]);

  function updateDraft(roleName: string, patch: Partial<DraftAgentConfig>) {
    setDrafts((current) => ({
      ...current,
      [roleName]: {
        ...current[roleName],
        ...patch,
      },
    }));
  }

  function applyProvider(roleName: string, provider: string) {
    const defaultModel = getDefaultModelForProvider(provider);

    updateDraft(roleName, {
      provider,
      ...(defaultModel ? { model: defaultModel } : {}),
    });
  }

  async function saveAgent(roleName: string) {
    const draft = drafts[roleName];
    const provider = draft.provider.trim();
    const model = draft.model.trim();
    const temperature = Number(draft.temperature);
    const maxTokens = Number(draft.maxTokens);

    if (!provider) {
      setMessage(text.providerRequired);
      return;
    }

    if (!model) {
      setMessage(text.modelRequired);
      return;
    }

    if (!Number.isFinite(temperature) || temperature < MIN_TEMPERATURE || temperature > MAX_TEMPERATURE) {
      setMessage(text.temperatureHint);
      return;
    }

    if (!Number.isInteger(maxTokens) || maxTokens < 1) {
      setMessage(text.maxTokensHint);
      return;
    }

    setPendingRole(roleName);
    setMessage(text.saving(roleName));

    try {
      const response = await fetch(`${API_BASE_URL}/projects/${projectId}/agents/${roleName}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enabled: draft.enabled,
          provider,
          model,
          fallbackModel: draft.fallbackModel.trim() || null,
          temperature,
          maxTokens,
          canWriteFiles: draft.canWriteFiles,
          canRunCommands: draft.canRunCommands,
        }),
      });

      const payload = await parseJsonResponse<{ agent?: AgentConfig; error?: string; message?: string }>(response);

      if (!response.ok) {
        throw new Error(readApiError(payload, text.saveFailed));
      }

      const updatedAgent = payload.agent;

      if (updatedAgent) {
        setSavedAgents((current) => ({
          ...current,
          [roleName]: updatedAgent,
        }));
      }

      setMessage(text.saved(roleName));
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text.saveFailed);
    } finally {
      setPendingRole(null);
    }
  }

  return (
    <div className="stack">
      <div className="feedback">{message}</div>
      {agents.map((agent) => {
        const draft = drafts[agent.roleName];
        const currentAgent = savedAgents[agent.roleName] ?? agent;
        const busy = pendingRole === agent.roleName;
        const providerModels = getProviderModels(draft.provider);

        return (
          <div key={agent.id} className="task-item">
            <div>
              <strong>{agent.roleName}</strong>
              <div className="muted">
                {text.current}: {currentAgent.provider} / {currentAgent.model}
              </div>
            </div>

            <div className="grid-2">
              <div className="field">
                <label>{text.presetProvider}</label>
                <select value={draft.provider} onChange={(event) => applyProvider(agent.roleName, event.target.value)}>
                  {PROVIDER_PRESETS.map((preset) => (
                    <option key={preset.value} value={preset.value}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{text.presetModel}</label>
                <select
                  value={providerModels.some((option) => option.value === draft.model) ? draft.model : ""}
                  onChange={(event) => updateDraft(agent.roleName, { model: event.target.value })}
                >
                  <option value="">{text.customModel}</option>
                  {providerModels.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid-2">
              <div className="field">
                <label>{text.provider}</label>
                <input
                  value={draft.provider}
                  onChange={(event) => updateDraft(agent.roleName, { provider: event.target.value })}
                  placeholder="mock, opencode, nvidia, openai"
                />
              </div>
              <div className="field">
                <label>{text.model}</label>
                <input
                  value={draft.model}
                  onChange={(event) => updateDraft(agent.roleName, { model: event.target.value })}
                  placeholder="mimo-v2-pro-free, qwen3.6-plus-free, gpt-5.4"
                />
              </div>
            </div>

            <div className="grid-2">
              <div className="field">
                <label>{text.fallback}</label>
                <input
                  value={draft.fallbackModel}
                  onChange={(event) => updateDraft(agent.roleName, { fallbackModel: event.target.value })}
                  placeholder={text.optional}
                />
              </div>
              <div className="field">
                <label>{text.temperatureMaxTokens}</label>
                <div className="grid-2">
                  <input
                    value={draft.temperature}
                    onChange={(event) => updateDraft(agent.roleName, { temperature: event.target.value })}
                    placeholder="0.2"
                  />
                  <input
                    value={draft.maxTokens}
                    onChange={(event) => updateDraft(agent.roleName, { maxTokens: event.target.value })}
                    placeholder="32000"
                  />
                </div>
                <div className="muted">{text.limits}</div>
              </div>
            </div>

            <div className="inline-meta">
              <label className="tag">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) => updateDraft(agent.roleName, { enabled: event.target.checked })}
                />
                {text.enabled}
              </label>
              <label className="tag">
                <input
                  type="checkbox"
                  checked={draft.canWriteFiles}
                  onChange={(event) => updateDraft(agent.roleName, { canWriteFiles: event.target.checked })}
                />
                {text.writeFiles}
              </label>
              <label className="tag">
                <input
                  type="checkbox"
                  checked={draft.canRunCommands}
                  onChange={(event) => updateDraft(agent.roleName, { canRunCommands: event.target.checked })}
                />
                {text.runCommands}
              </label>
            </div>

            <div className="button-row">
              <button className="button secondary" type="button" onClick={() => saveAgent(agent.roleName)} disabled={busy}>
                {busy ? text.savingShort : text.saveConfig}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
