"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { ProjectMemorySource } from "../../../lib/api";
import { CLIENT_API_BASE_URL } from "../../../lib/client-api";
import { parseJsonResponse, readApiError } from "../../../lib/http";
import { formatDateTime } from "../../../lib/i18n";
import { useLanguage } from "../../language-provider";

const API_BASE_URL = CLIENT_API_BASE_URL;

type DraftMemorySource = ProjectMemorySource & {
  key: string;
};

function toSummaryText(summary: string[]) {
  return summary.join("\n");
}

function createSourceKey(source: ProjectMemorySource) {
  return `${source.kind}:${source.path}`;
}

export function ProjectMemoryPanel({
  projectId,
  memory,
  memoryUpdatedAt,
}: {
  projectId: string;
  memory: {
    summary: string[];
    promptBlock?: string;
    sources: ProjectMemorySource[];
  };
  memoryUpdatedAt: string | null;
}) {
  const { language } = useLanguage();
  const router = useRouter();
  const initialSources = useMemo<DraftMemorySource[]>(
    () => memory.sources.map((source) => ({ ...source, key: createSourceKey(source) })),
    [memory.sources],
  );
  const [summaryText, setSummaryText] = useState(toSummaryText(memory.summary));
  const [sources, setSources] = useState(initialSources);
  const [pendingAction, setPendingAction] = useState<"save" | "rebuild" | null>(null);
  const text =
    language === "zh"
      ? {
          idle: "可以编辑已持久化的项目记忆，或从源文档重新构建。",
          saving: "正在保存项目记忆...",
          saveFailed: "保存项目记忆失败",
          saved: "项目记忆已保存。",
          rebuilding: "正在从源文档重建项目记忆...",
          rebuildFailed: "重建项目记忆失败",
          rebuilt: "项目记忆已从源文档重建。",
          sources: "条来源",
          savedAt: "保存于",
          summaryLines: "摘要行",
          label: "标签",
          snippet: "摘要片段",
          empty: "当前还没有项目记忆来源。",
          savingShort: "保存中...",
          saveMemory: "保存记忆",
          rebuildingShort: "重建中...",
          rebuild: "从文档重建",
        }
      : {
          idle: "Edit the persisted project memory or rebuild it from source docs.",
          saving: "Saving project memory...",
          saveFailed: "Failed to save project memory",
          saved: "Project memory saved.",
          rebuilding: "Rebuilding project memory from source documents...",
          rebuildFailed: "Failed to rebuild project memory",
          rebuilt: "Project memory rebuilt from source documents.",
          sources: "sources",
          savedAt: "saved",
          summaryLines: "Summary Lines",
          label: "Label",
          snippet: "Snippet",
          empty: "No project memory sources are available yet.",
          savingShort: "Saving...",
          saveMemory: "Save Memory",
          rebuildingShort: "Rebuilding...",
          rebuild: "Rebuild From Docs",
        };
  const [message, setMessage] = useState(text.idle);

  function updateSource(key: string, patch: Partial<DraftMemorySource>) {
    setSources((current) =>
      current.map((source) => (source.key === key ? { ...source, ...patch } : source)),
    );
  }

  async function saveMemory() {
    setPendingAction("save");
    setMessage(text.saving);

    try {
      const response = await fetch(`${API_BASE_URL}/projects/${projectId}/memory`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: summaryText
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean),
          sources: sources.map(({ key, ...source }) => source),
        }),
      });
      const payload = await parseJsonResponse<{ error?: string; message?: string }>(response);

      if (!response.ok) {
        throw new Error(readApiError(payload, "Failed to save project memory"));
      }

      setMessage(text.saved);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text.saveFailed);
    } finally {
      setPendingAction(null);
    }
  }

  async function rebuildMemory() {
    setPendingAction("rebuild");
    setMessage(text.rebuilding);

    try {
      const response = await fetch(`${API_BASE_URL}/projects/${projectId}/memory/rebuild`, {
        method: "POST",
      });
      const payload = await parseJsonResponse<{ error?: string; message?: string }>(response);

      if (!response.ok) {
        throw new Error(readApiError(payload, "Failed to rebuild project memory"));
      }

      setMessage(text.rebuilt);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text.rebuildFailed);
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="stack">
      <div className="feedback">{message}</div>
      <div className="inline-meta">
        <span className="tag">{sources.length} {text.sources}</span>
        {memoryUpdatedAt ? <span className="tag">{text.savedAt} {formatDateTime(memoryUpdatedAt)}</span> : null}
      </div>

      <div className="field">
        <label>{text.summaryLines}</label>
        <textarea
          value={summaryText}
          onChange={(event) => setSummaryText(event.target.value)}
          rows={Math.max(4, memory.summary.length + 1)}
        />
      </div>

      {sources.length > 0 ? (
        <div className="memory-list">
          {sources.map((source) => (
            <article key={source.key} className="memory-item">
              <div className="inline-meta">
                <span className="tag">{source.kind}</span>
                <code>{source.path}</code>
              </div>
              <div className="field">
                <label>{text.label}</label>
                <input
                  value={source.label}
                  onChange={(event) => updateSource(source.key, { label: event.target.value })}
                />
              </div>
              <div className="field">
                <label>{text.snippet}</label>
                <textarea
                  value={source.snippet}
                  onChange={(event) => updateSource(source.key, { snippet: event.target.value })}
                  rows={5}
                />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty">{text.empty}</div>
      )}

      <div className="button-row">
        <button className="button secondary" type="button" onClick={saveMemory} disabled={pendingAction !== null}>
          {pendingAction === "save" ? text.savingShort : text.saveMemory}
        </button>
        <button className="button ghost" type="button" onClick={rebuildMemory} disabled={pendingAction !== null}>
          {pendingAction === "rebuild" ? text.rebuildingShort : text.rebuild}
        </button>
      </div>
    </div>
  );
}
