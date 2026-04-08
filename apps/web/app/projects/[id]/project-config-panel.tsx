"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { CLIENT_API_BASE_URL } from "../../../lib/client-api";
import { parseJsonResponse, readApiError } from "../../../lib/http";
import { useLanguage } from "../../language-provider";

const API_BASE_URL = CLIENT_API_BASE_URL;

type ProjectConfig = {
  id: string;
  name: string;
  projectType: string;
  rootPath: string;
  introFilePath: string | null;
  doneProgressFilePath: string | null;
  futureFilePath: string | null;
  implementationPlanFilePath: string | null;
  designBriefFilePath: string | null;
  interactionRulesFilePath: string | null;
  visualReferencesFilePath: string | null;
  referenceDocs: string[];
  todoProgressFilePath: string;
  buildCommand: string | null;
  testCommand: string | null;
  lintCommand: string | null;
  startCommand: string | null;
  allowedPaths: string[];
  blockedPaths: string[];
  defaultBranch: string | null;
};

type DraftProjectConfig = {
  name: string;
  todoProgressFilePath: string;
  introFilePath: string;
  doneProgressFilePath: string;
  futureFilePath: string;
  implementationPlanFilePath: string;
  designBriefFilePath: string;
  interactionRulesFilePath: string;
  visualReferencesFilePath: string;
  referenceDocs: string;
  testCommand: string;
  buildCommand: string;
  lintCommand: string;
  startCommand: string;
  allowedPaths: string;
  blockedPaths: string;
  defaultBranch: string;
};

function joinLines(items: string[]) {
  return items.join("\n");
}

function toDraft(project: ProjectConfig): DraftProjectConfig {
  return {
    name: project.name,
    todoProgressFilePath: project.todoProgressFilePath,
    introFilePath: project.introFilePath ?? "",
    doneProgressFilePath: project.doneProgressFilePath ?? "",
    futureFilePath: project.futureFilePath ?? "",
    implementationPlanFilePath: project.implementationPlanFilePath ?? "",
    designBriefFilePath: project.designBriefFilePath ?? "",
    interactionRulesFilePath: project.interactionRulesFilePath ?? "",
    visualReferencesFilePath: project.visualReferencesFilePath ?? "",
    referenceDocs: joinLines(project.referenceDocs),
    testCommand: project.testCommand ?? "",
    buildCommand: project.buildCommand ?? "",
    lintCommand: project.lintCommand ?? "",
    startCommand: project.startCommand ?? "",
    allowedPaths: joinLines(project.allowedPaths),
    blockedPaths: joinLines(project.blockedPaths),
    defaultBranch: project.defaultBranch ?? "",
  };
}

function projectTypeLabel(projectType: string, language: "en" | "zh") {
  if (language === "zh") {
    return projectType === "existing" ? "老项目" : "新项目";
  }

  return projectType === "existing" ? "Existing Project" : "New Project";
}

function getText(language: "en" | "zh") {
  if (language === "zh") {
    return {
      idle: "可以在这里修改项目配置。更新任务来源后会重新解析任务列表。",
      saving: "正在保存项目配置...",
      saveFailed: "保存项目配置失败",
      saved: "项目配置已保存。",
      savingShort: "保存中...",
      saveConfig: "保存配置",
      projectName: "项目名称",
      projectType: "项目类型",
      projectRoot: "项目根目录",
      todoSource: "任务来源",
      primaryReference: "主参考文档",
      completedDoc: "已完成功能文档",
      futureDoc: "未来规划文档",
      implementationPlan: "实现计划文档",
      designBrief: "设计简报",
      interactionRules: "交互规则",
      visualReferences: "视觉参考",
      extraDocs: "额外参考文档",
      testCommand: "测试命令",
      buildCommand: "构建命令",
      lintCommand: "Lint 命令",
      startCommand: "启动命令",
      allowedPaths: "允许修改路径",
      blockedPaths: "禁止修改路径",
      defaultBranch: "默认分支",
      onePathPerLine: "每行一个绝对路径",
      oneRelativePerLine: "每行一个相对路径",
      optional: "可选",
      taskSourceHint: "如果这里指向的是索引文档，ForgeFlow 会自动解析并保存实际任务文件。",
    };
  }

  return {
    idle: "Edit the project configuration here. Updating the task source reparses the task list.",
    saving: "Saving project configuration...",
    saveFailed: "Failed to save project configuration",
    saved: "Project configuration saved.",
    savingShort: "Saving...",
    saveConfig: "Save Config",
    projectName: "Project Name",
    projectType: "Project Type",
    projectRoot: "Project Root",
    todoSource: "Task Source",
    primaryReference: "Primary Reference Doc",
    completedDoc: "Completed Features Doc",
    futureDoc: "Future Roadmap Doc",
    implementationPlan: "Implementation Plan Doc",
    designBrief: "Design Brief",
    interactionRules: "Interaction Rules",
    visualReferences: "Visual References",
    extraDocs: "Extra Reference Docs",
    testCommand: "Test Command",
    buildCommand: "Build Command",
    lintCommand: "Lint Command",
    startCommand: "Start Command",
    allowedPaths: "Allowed Paths",
    blockedPaths: "Blocked Paths",
    defaultBranch: "Default Branch",
    onePathPerLine: "One absolute path per line",
    oneRelativePerLine: "One relative path per line",
    optional: "Optional",
    taskSourceHint: "If this points at an index document, ForgeFlow resolves and stores the actual task file automatically.",
  };
}

export function ProjectConfigPanel({ project }: { project: ProjectConfig }) {
  const { language } = useLanguage();
  const router = useRouter();
  const text = getText(language);
  const [draft, setDraft] = useState<DraftProjectConfig>(() => toDraft(project));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(text.idle);

  useEffect(() => {
    setDraft(toDraft(project));
  }, [project]);

  useEffect(() => {
    setMessage(text.idle);
  }, [text.idle]);

  function updateDraft<K extends keyof DraftProjectConfig>(key: K, value: DraftProjectConfig[K]) {
    setDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function saveConfig() {
    setPending(true);
    setMessage(text.saving);

    try {
      const response = await fetch(`${API_BASE_URL}/projects/${project.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: draft.name,
          todoProgressFilePath: draft.todoProgressFilePath,
          introFilePath: draft.introFilePath || null,
          doneProgressFilePath: draft.doneProgressFilePath || null,
          futureFilePath: draft.futureFilePath || null,
          implementationPlanFilePath: draft.implementationPlanFilePath || null,
          designBriefFilePath: draft.designBriefFilePath || null,
          interactionRulesFilePath: draft.interactionRulesFilePath || null,
          visualReferencesFilePath: draft.visualReferencesFilePath || null,
          referenceDocs: draft.referenceDocs
            .split(/\r?\n/)
            .map((entry) => entry.trim())
            .filter(Boolean),
          testCommand: draft.testCommand || null,
          buildCommand: draft.buildCommand || null,
          lintCommand: draft.lintCommand || null,
          startCommand: draft.startCommand || null,
          allowedPaths: draft.allowedPaths
            .split(/\r?\n/)
            .map((entry) => entry.trim())
            .filter(Boolean),
          blockedPaths: draft.blockedPaths
            .split(/\r?\n/)
            .map((entry) => entry.trim())
            .filter(Boolean),
          defaultBranch: draft.defaultBranch || null,
        }),
      });
      const payload = await parseJsonResponse<{ error?: string; message?: string }>(response);

      if (!response.ok) {
        throw new Error(readApiError(payload, text.saveFailed));
      }

      setMessage(text.saved);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text.saveFailed);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="stack">
      <div className="feedback">{message}</div>

      <div className="grid-2">
        <div className="field">
          <label>{text.projectName}</label>
          <input value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} />
        </div>
        <div className="field">
          <label>{text.projectType}</label>
          <input value={projectTypeLabel(project.projectType, language)} disabled />
        </div>
      </div>

      <div className="field">
        <label>{text.projectRoot}</label>
        <input value={project.rootPath} disabled />
      </div>

      <div className="grid-2">
        <div className="field">
          <label>{text.todoSource}</label>
          <input
            value={draft.todoProgressFilePath}
            onChange={(event) => updateDraft("todoProgressFilePath", event.target.value)}
          />
          <div className="muted">{text.taskSourceHint}</div>
        </div>
        <div className="field">
          <label>{text.primaryReference}</label>
          <input value={draft.introFilePath} onChange={(event) => updateDraft("introFilePath", event.target.value)} />
        </div>
      </div>

      <div className="grid-2">
        <div className="field">
          <label>{text.completedDoc}</label>
          <input
            value={draft.doneProgressFilePath}
            onChange={(event) => updateDraft("doneProgressFilePath", event.target.value)}
            placeholder={text.optional}
          />
        </div>
        <div className="field">
          <label>{text.futureDoc}</label>
          <input
            value={draft.futureFilePath}
            onChange={(event) => updateDraft("futureFilePath", event.target.value)}
            placeholder={text.optional}
          />
        </div>
      </div>

      <div className="grid-2">
        <div className="field">
          <label>{text.implementationPlan}</label>
          <input
            value={draft.implementationPlanFilePath}
            onChange={(event) => updateDraft("implementationPlanFilePath", event.target.value)}
            placeholder={text.optional}
          />
        </div>
        <div className="field">
          <label>{text.designBrief}</label>
          <input
            value={draft.designBriefFilePath}
            onChange={(event) => updateDraft("designBriefFilePath", event.target.value)}
            placeholder={text.optional}
          />
        </div>
      </div>

      <div className="grid-2">
        <div className="field">
          <label>{text.interactionRules}</label>
          <input
            value={draft.interactionRulesFilePath}
            onChange={(event) => updateDraft("interactionRulesFilePath", event.target.value)}
            placeholder={text.optional}
          />
        </div>
        <div className="field">
          <label>{text.visualReferences}</label>
          <input
            value={draft.visualReferencesFilePath}
            onChange={(event) => updateDraft("visualReferencesFilePath", event.target.value)}
            placeholder={text.optional}
          />
        </div>
      </div>

      <div className="grid-2">
        <div className="field">
          <label>{text.extraDocs}</label>
          <textarea
            value={draft.referenceDocs}
            onChange={(event) => updateDraft("referenceDocs", event.target.value)}
            placeholder={text.onePathPerLine}
          />
        </div>
      </div>

      <div className="grid-2">
        <div className="field">
          <label>{text.testCommand}</label>
          <input value={draft.testCommand} onChange={(event) => updateDraft("testCommand", event.target.value)} />
        </div>
        <div className="field">
          <label>{text.buildCommand}</label>
          <input value={draft.buildCommand} onChange={(event) => updateDraft("buildCommand", event.target.value)} />
        </div>
      </div>

      <div className="grid-2">
        <div className="field">
          <label>{text.lintCommand}</label>
          <input value={draft.lintCommand} onChange={(event) => updateDraft("lintCommand", event.target.value)} />
        </div>
        <div className="field">
          <label>{text.startCommand}</label>
          <input value={draft.startCommand} onChange={(event) => updateDraft("startCommand", event.target.value)} />
        </div>
      </div>

      <div className="grid-2">
        <div className="field">
          <label>{text.allowedPaths}</label>
          <textarea
            value={draft.allowedPaths}
            onChange={(event) => updateDraft("allowedPaths", event.target.value)}
            placeholder={text.oneRelativePerLine}
          />
        </div>
        <div className="field">
          <label>{text.blockedPaths}</label>
          <textarea
            value={draft.blockedPaths}
            onChange={(event) => updateDraft("blockedPaths", event.target.value)}
            placeholder={text.oneRelativePerLine}
          />
        </div>
      </div>

      <div className="field">
        <label>{text.defaultBranch}</label>
        <input
          value={draft.defaultBranch}
          onChange={(event) => updateDraft("defaultBranch", event.target.value)}
          placeholder="main"
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
