import type { Route } from "next";
import Link from "next/link";
import { cookies } from "next/headers";

import { getProjectDetail } from "../../../lib/api";
import { LANGUAGE_COOKIE_NAME, resolveLanguage, type Language } from "../../../lib/i18n";
import { AgentConfigPanel } from "./agent-config-panel";
import { AutopilotConfigPanel } from "./autopilot-config-panel";
import { LiveActivity } from "./live-activity";
import { ProjectMemoryPanel } from "./project-memory-panel";
import { ProjectActions } from "./project-actions";
import { ProjectConfigPanel } from "./project-config-panel";
import { TaskBoard } from "./task-board";

function projectTypeLabel(projectType: string, language: Language) {
  if (language === "zh") {
    return projectType === "existing" ? "老项目" : "新项目";
  }

  return projectType === "existing" ? "Existing Project" : "New Project";
}

function intakeEngineLabel(engine: string | null, language: Language) {
  if (!engine) {
    return language === "zh" ? "未记录" : "Not recorded";
  }

  if (engine === "heuristic-forced") {
    return "heuristic";
  }

  return engine;
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const language = resolveLanguage(cookieStore.get(LANGUAGE_COOKIE_NAME)?.value);
  const { detail } = await getProjectDetail(id);
  const projectRunsHref = `/projects/${id}/runs` as Route;
  const text =
    language === "zh"
      ? {
          back: "返回项目列表",
          runs: "查看全部 Runs",
          detail: "项目详情",
          next: "下一项",
          done: "已完成",
          waiting: "待人工",
          failed: "失败",
          taskBoard: "任务看板",
          projectConfig: "项目配置",
          projectType: "项目类型",
          todo: "任务来源",
          primaryReference: "主参考文档",
          completedDoc: "已完成功能文档",
          futureDoc: "未来规划文档",
          implementationPlan: "实现计划文档",
          intakeEngine: "最终 Intake 引擎",
          extraDocs: "额外参考文档",
          testCommand: "测试命令",
          buildCommand: "构建命令",
          lintCommand: "Lint 命令",
          startCommand: "启动命令",
          allowedPaths: "允许修改路径",
  notConfigured: "未配置",
  projectMemory: "项目记忆",
  agentConfig: "Agent 配置",
  autopilotConfig: "自动驾驶配置",
  recentRuns: "最近 Runs",
          noHistory: "还没有执行记录。",
          liveActivity: "实时活动",
          projectRoot: "项目根目录",
        }
  : {
  back: "Back To Projects",
  runs: "View All Runs",
  detail: "Project Detail",
  next: "next",
  done: "done",
  waiting: "waiting",
  failed: "failed",
  taskBoard: "Task Board",
  projectConfig: "Project Config",
  projectType: "Project Type",
  todo: "Task Source",
  primaryReference: "Primary Reference",
  completedDoc: "Completed Features Doc",
  futureDoc: "Future Roadmap Doc",
  implementationPlan: "Implementation Plan",
  intakeEngine: "Final Intake Engine",
  extraDocs: "Extra Reference Docs",
  testCommand: "Test Command",
  buildCommand: "Build Command",
  lintCommand: "Lint Command",
  startCommand: "Start Command",
  allowedPaths: "Allowed Paths",
  notConfigured: "Not configured",
  projectMemory: "Project Memory",
  agentConfig: "Agent Config",
  autopilotConfig: "Autopilot Config",
  recentRuns: "Recent Runs",
  noHistory: "No execution history yet.",
  liveActivity: "Live Activity",
  projectRoot: "Project Root",
};

  return (
    <main className="shell">
      <div className="detail-header detail-shell">
        <div className="inline-meta">
          <Link href="/" className="tag">
            {text.back}
          </Link>
          <Link href={projectRunsHref} className="tag">
            {text.runs}
          </Link>
        </div>

        <div className="hero-card project-hero">
          <span className="eyebrow">{text.detail}</span>
          <h1>{detail.project.name}</h1>
          <p className="muted">{detail.project.rootPath}</p>

          <div className="inline-meta">
            <span className="tag">{projectTypeLabel(detail.project.projectType, language)}</span>
            <span className="tag">{detail.summary.status}</span>
            {detail.summary.nextTaskCode ? <span className="tag">{text.next}: {detail.summary.nextTaskCode}</span> : null}
          </div>

          <div className="project-stats-grid project-stats-grid-wide">
            <div className="project-stat">
              <span className="muted">{text.done}</span>
              <strong>{detail.summary.counts.done}</strong>
            </div>
            <div className="project-stat">
              <span className="muted">{text.waiting}</span>
              <strong>{detail.summary.counts.waiting_human}</strong>
            </div>
            <div className="project-stat">
              <span className="muted">{text.failed}</span>
              <strong>{detail.summary.counts.failed}</strong>
            </div>
            <div className="project-stat">
              <span className="muted">{text.intakeEngine}</span>
              <strong>{intakeEngineLabel(detail.project.intakeEngine, language)}</strong>
            </div>
          </div>
        </div>
      </div>

      <section className="detail-grid">
        <div className="panel">
          <div className="panel-title-row">
            <div>
              <h2>{text.taskBoard}</h2>
            </div>
          </div>
            <ProjectActions projectId={detail.project.id} autoRunEnabled={detail.project.autoRunEnabled} safeAutoRunEnabled={detail.project.safeAutoRunEnabled} />
          <TaskBoard tasks={detail.tasks} />
        </div>

        <div className="stack">
          <section className="panel">
            <div className="panel-title-row">
              <div>
                <h2>{text.projectConfig}</h2>
              </div>
            </div>
            <ProjectConfigPanel project={detail.project} />
          </section>

          <section className="panel">
            <h2>{text.projectMemory}</h2>
            <ProjectMemoryPanel
              projectId={detail.project.id}
              memory={detail.memory}
              memoryUpdatedAt={detail.project.memoryUpdatedAt}
            />
          </section>

<section className="panel">
  <h2>{text.agentConfig}</h2>
  <AgentConfigPanel projectId={detail.project.id} agents={detail.agents} />
</section>

<section className="panel">
  <h2>{text.autopilotConfig}</h2>
  <AutopilotConfigPanel projectId={detail.project.id} />
</section>

<section className="panel">
            <h2>{text.recentRuns}</h2>
            {detail.runs.length === 0 ? (
              <div className="empty">{text.noHistory}</div>
            ) : (
              <div className="run-list">
                {detail.runs.map((run) => {
                  const runHref = `/projects/${id}/runs/${run.id}` as Route;

                  return (
                    <Link key={run.id} href={runHref} className="run-item">
                      <div className="inline-meta">
                        {run.taskCode ? <span className="tag">{run.taskCode}</span> : null}
                        <span className="tag">{run.roleName}</span>
                        <span className="tag">{run.model}</span>
                        <span className="tag">{run.status}</span>
                      </div>
                      {run.taskTitle ? <strong>{run.taskTitle}</strong> : null}
                      <div className="muted">{run.outputSummary}</div>
                      {run.commandRuns.length > 0 ? (
                        <div className="inline-meta">
                          {run.commandRuns.map((commandRun) => (
                            <span
                              key={commandRun.id}
                              className={`tag ${commandRun.exitCode === 0 ? "good" : "bad"}`}
                            >
                              {commandRun.command} ({commandRun.exitCode})
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          <section className="panel">
            <h2>{text.liveActivity}</h2>
            <LiveActivity projectId={detail.project.id} />
          </section>
        </div>
      </section>
    </main>
  );
}
