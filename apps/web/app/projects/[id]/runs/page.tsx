import type { Route } from "next";
import Link from "next/link";
import { cookies } from "next/headers";

import { getProjectRuns } from "../../../../lib/api";
import { formatDateTime, LANGUAGE_COOKIE_NAME, resolveLanguage } from "../../../../lib/i18n";

export default async function ProjectRunsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const language = resolveLanguage(cookieStore.get(LANGUAGE_COOKIE_NAME)?.value);
  const { runs } = await getProjectRuns(id);
  const projectHref = `/projects/${id}` as Route;
  const text =
    language === "zh"
      ? {
          back: "返回项目详情",
          description: "查看该项目的完整执行记录、角色输出摘要和命令执行结果。",
          title: "全部 Runs",
          empty: "当前还没有执行记录。",
          started: "开始",
          ended: "结束",
        }
      : {
          back: "Back To Project",
          description: "Inspect the full execution history, role output summaries, and verification command results for this project.",
          title: "All Runs",
          empty: "No execution history yet.",
          started: "Started",
          ended: "Ended",
        };

  return (
    <main className="shell">
      <div className="detail-header">
        <Link href={projectHref} className="tag">
          {text.back}
        </Link>
        <div>
          <span className="eyebrow">Runs</span>
          <h1>Execution History</h1>
          <p className="muted">{text.description}</p>
        </div>
      </div>

      <section className="table-panel">
        <h2>{text.title}</h2>
        {runs.length === 0 ? (
          <div className="empty">{text.empty}</div>
        ) : (
          <div className="run-list">
            {runs.map((run) => {
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
                  <div className="muted">
                    {text.started}: {formatDateTime(run.startedAt)}
                    {run.endedAt ? ` | ${text.ended}: ${formatDateTime(run.endedAt)}` : ""}
                  </div>
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
    </main>
  );
}
