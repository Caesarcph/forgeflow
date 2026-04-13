import Link from "next/link";
import { cookies } from "next/headers";

import { getProjects, getStartupDiagnostics } from "../lib/api";
import { LANGUAGE_COOKIE_NAME, resolveLanguage, type Language } from "../lib/i18n";
import { ProjectCreateForm } from "./project-create-form";
import { StartupDiagnosticsPanel } from "./startup-diagnostics-panel";

function projectTypeLabel(projectType: string | undefined, language: Language) {
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

export default async function HomePage() {
  const cookieStore = await cookies();
  const language = resolveLanguage(cookieStore.get(LANGUAGE_COOKIE_NAME)?.value);
  const { projects } = await getProjects().catch(() => ({ projects: [] }));
  const diagnostics = await getStartupDiagnostics().catch(() => ({ diagnostics: null }));
  const text =
    language === "zh"
      ? {
          eyebrow: "ForgeFlow 调度台",
          title: "先把项目理解清楚，再让编排接管执行",
          description:
            "你可以先做新项目头脑风暴，也可以导入老项目。系统会识别 TODO、计划文档、参考文档和脚本，再决定什么时候进入正式执行。",
          operatingMode: "当前定位",
          operatingModeValue: "本地优先、可审计的多 Agent 开发控制台",
          alphaStatus: "阶段",
          alphaStatusValue: "本地 Alpha",
          projectCount: "项目数",
          taskCount: "任务总数",
          doneCount: "已完成任务",
          intakeTitle: "项目 Intake",
          intakeSubtitle: "先确定项目边界、文档来源、TODO 主清单和执行命令。",
          fleetTitle: "项目列表",
          fleetSubtitle: "导入后的项目会在这里排队、执行、审阅和回写。",
          emptyProjects: "还没有项目。先在右侧创建一个新项目，或者导入一个已有仓库。",
          active: "进行中",
          tasks: "任务",
          done: "已完成",
          waiting: "待人工",
          failed: "失败",
          status: "状态",
          intakeEngine: "最终 Intake 引擎",
        }
      : {
          eyebrow: "ForgeFlow Control Deck",
          title: "Understand the repo first, then let orchestration take over",
          description:
            "Brainstorm greenfield work or import an existing workspace, identify TODO sources, plans, references, and scripts, then decide when the project is ready for execution.",
          operatingMode: "Operating Mode",
          operatingModeValue: "Local-first, auditable multi-agent delivery control plane",
          alphaStatus: "Stage",
          alphaStatusValue: "Local Alpha",
          projectCount: "Projects",
          taskCount: "Total Tasks",
          doneCount: "Completed Tasks",
          intakeTitle: "Project Intake",
          intakeSubtitle: "Set the project boundary, document sources, TODO list, and execution commands.",
          fleetTitle: "Project Fleet",
          fleetSubtitle: "Imported projects line up here for execution, review, and writeback.",
          emptyProjects: "No projects yet. Create one on the right or import an existing repository.",
          active: "active",
          tasks: "tasks",
          done: "done",
          waiting: "waiting",
          failed: "failed",
          status: "status",
          intakeEngine: "Final Intake Engine",
        };

  return (
    <main className="shell">
      <section className="hero">
        <div className="hero-card hero-story">
          <span className="eyebrow">{text.eyebrow}</span>
          <h1>{text.title}</h1>
          <p className="muted hero-copy">{text.description}</p>

          <div className="hero-status-grid">
            <div className="hero-status-card">
              <span className="kicker">{text.operatingMode}</span>
              <strong>{text.operatingModeValue}</strong>
            </div>
            <div className="hero-status-card">
              <span className="kicker">{text.alphaStatus}</span>
              <strong>{text.alphaStatusValue}</strong>
            </div>
          </div>

          <div className="metrics metrics-wide">
            <div className="metric">
              <span className="muted">{text.projectCount}</span>
              <strong>{projects.length}</strong>
            </div>
            <div className="metric">
              <span className="muted">{text.taskCount}</span>
              <strong>{projects.reduce((sum, project) => sum + project.totalTasks, 0)}</strong>
            </div>
            <div className="metric">
              <span className="muted">{text.doneCount}</span>
              <strong>{projects.reduce((sum, project) => sum + project.doneTasks, 0)}</strong>
            </div>
          </div>
        </div>

        <div className="panel intake-panel">
          <div className="panel-title-row">
            <div>
              <h2>{text.intakeTitle}</h2>
              <p className="muted">{text.intakeSubtitle}</p>
            </div>
          </div>
          <ProjectCreateForm />
        </div>
      </section>

      <section className="table-panel">
        <div className="panel-title-row">
          <div>
            <h2>{text.fleetTitle}</h2>
            <p className="muted">{text.fleetSubtitle}</p>
          </div>
        </div>
        {projects.length === 0 ? (
          <div className="empty">{text.emptyProjects}</div>
        ) : (
          <div className="project-card-grid">
            {projects.map((project) => (
              <Link key={project.id} href={`/projects/${project.id}`} className="project-item project-item-strong">
                <div className="project-item-head">
                  <div>
                    <strong>{project.name}</strong>
                    <div className="muted">{project.rootPath}</div>
                  </div>
                  <div className="inline-meta">
                    <span className="tag">{projectTypeLabel(project.projectType, language)}</span>
                    <span className="tag">{text.status}: {project.status}</span>
                    <span className="tag">{text.intakeEngine}: {intakeEngineLabel(project.intakeEngine, language)}</span>
                  </div>
                </div>

                <div className="project-stats-grid">
                  <div className="project-stat">
                    <span className="muted">{text.active}</span>
                    <strong>{project.activeTasks}</strong>
                  </div>
                  <div className="project-stat">
                    <span className="muted">{text.tasks}</span>
                    <strong>{project.totalTasks}</strong>
                  </div>
                  <div className="project-stat">
                    <span className="muted">{text.done}</span>
                    <strong>{project.doneTasks}</strong>
                  </div>
                  <div className="project-stat">
                    <span className="muted">{text.waiting}</span>
                    <strong>{project.waitingHumanTasks}</strong>
                  </div>
                  <div className="project-stat">
                    <span className="muted">{text.failed}</span>
                    <strong>{project.failedTasks}</strong>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <StartupDiagnosticsPanel initialDiagnostics={diagnostics.diagnostics} />
    </main>
  );
}
