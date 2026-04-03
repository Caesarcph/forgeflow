import type { Route } from "next";
import Link from "next/link";

import { getRunDetail } from "../../../../../lib/api";
import { formatDateTime, formatTime } from "../../../../../lib/i18n";
import { RollbackRunButton } from "./rollback-run-button";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string; runId: string }>;
}) {
  const { id, runId } = await params;
  const { run } = await getRunDetail(runId);
  const runsHref = `/projects/${id}/runs` as Route;
  const projectHref = `/projects/${id}` as Route;

  return (
    <main className="shell">
      <div className="detail-header">
        <div className="inline-meta">
          <Link href={projectHref} className="tag">
            Back To Project
          </Link>
          <Link href={runsHref} className="tag">
            Back To Runs
          </Link>
        </div>
        <div>
          <span className="eyebrow">Run Detail</span>
          <h1>{run.taskCode ? `${run.taskCode} / ${run.roleName}` : run.roleName}</h1>
          <p className="muted">{run.project.name} / {run.model} / {run.status}</p>
        </div>
      </div>

      <section className="detail-grid">
        <div className="stack">
          <section className="panel">
            <h2>Summary</h2>
            <div className="stack">
              {run.taskTitle ? (
                <div>
                  <strong>Task</strong>
                  <div className="muted">{run.taskTitle}</div>
                </div>
              ) : null}
              <div>
                <strong>Input Summary</strong>
                <div className="muted">{run.inputSummary}</div>
              </div>
              <div>
                <strong>Output Summary</strong>
                <div className="muted">{run.outputSummary}</div>
              </div>
            </div>
          </section>

          {run.executionContext ? (
            <>
              <section className="panel">
                <h2>Exact Prompt</h2>
                <pre className="code-block">{run.executionContext.promptText}</pre>
              </section>

              <section className="panel">
                <h2>Execution Context</h2>
                <div className="stack">
                  <div>
                    <strong>Goal</strong>
                    <div className="muted">{run.executionContext.goal}</div>
                  </div>
                  <div>
                    <strong>Provider / Model</strong>
                    <div className="muted">
                      {run.executionContext.provider} / {run.executionContext.model}
                    </div>
                  </div>
                  {run.executionContext.executionRootPath ? (
                    <div>
                      <strong>Execution Workspace</strong>
                      <div className="muted">{run.executionContext.executionRootPath}</div>
                    </div>
                  ) : null}
                  <div>
                    <strong>System Prompt</strong>
                    <pre className="code-block compact-code">{run.executionContext.systemPrompt}</pre>
                  </div>
                  <div>
                    <strong>Raw Task Text</strong>
                    <pre className="code-block compact-code">{run.executionContext.rawTaskText}</pre>
                  </div>
                </div>
              </section>

              <section className="panel">
                <h2>Relevant Files</h2>
                {run.executionContext.relevantFiles.length === 0 ? (
                  <div className="empty">No relevant files were injected for this run.</div>
                ) : (
                  <div className="memory-list">
                    {run.executionContext.relevantFiles.map((filePath) => (
                      <div key={filePath} className="memory-item">
                        <code>{filePath}</code>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="panel">
                <h2>Detected File Changes</h2>
                {run.executionContext.fileChanges?.all.length ? (
                  <div className="stack">
                    <div className="inline-meta">
                      <span className="tag">all: {run.executionContext.fileChanges.all.length}</span>
                      <span className="tag">added: {run.executionContext.fileChanges.added.length}</span>
                      <span className="tag">modified: {run.executionContext.fileChanges.modified.length}</span>
                      <span className="tag">deleted: {run.executionContext.fileChanges.deleted.length}</span>
                    </div>
                    <pre className="code-block compact-code">
                      {run.executionContext.fileChanges.all.join("\n")}
                    </pre>
                  </div>
                ) : (
                  <div className="empty">No project files changed during this run.</div>
                )}
              </section>

              {run.executionContext.gitPreflight ? (
                <section className="panel">
                  <h2>Git Preflight</h2>
                  <div className="stack">
                    <div className="inline-meta">
                      <span className="tag">
                        {run.executionContext.gitPreflight.isGitRepo ? "git repo" : "not git"}
                      </span>
                      {run.executionContext.gitPreflight.branch ? (
                        <span className="tag">branch: {run.executionContext.gitPreflight.branch}</span>
                      ) : null}
                      {run.executionContext.gitPreflight.defaultBranch ? (
                        <span className="tag">expected: {run.executionContext.gitPreflight.defaultBranch}</span>
                      ) : null}
                      <span
                        className={`tag ${run.executionContext.gitPreflight.hasUncommittedChanges ? "bad" : "good"}`}
                      >
                        {run.executionContext.gitPreflight.hasUncommittedChanges
                          ? `${run.executionContext.gitPreflight.statusLines.length} dirty`
                          : "clean"}
                      </span>
                    </div>
                    {run.executionContext.gitPreflight.repoRoot ? (
                      <div>
                        <strong>Repo Root</strong>
                        <div className="muted">{run.executionContext.gitPreflight.repoRoot}</div>
                      </div>
                    ) : null}
                    {run.executionContext.gitPreflight.headCommit ? (
                      <div>
                        <strong>Head Commit</strong>
                        <code>{run.executionContext.gitPreflight.headCommit}</code>
                      </div>
                    ) : null}
                    {run.executionContext.gitPreflight.warnings.length > 0 ? (
                      <div className="stack">
                        <strong>Warnings</strong>
                        <div className="memory-list">
                          {run.executionContext.gitPreflight.warnings.map((warning) => (
                            <div key={warning} className="memory-item">
                              <div className="muted">{warning}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {run.executionContext.gitPreflight.statusLines.length > 0 ? (
                      <div>
                        <strong>Pre-Run Status</strong>
                        <pre className="code-block compact-code">
                          {run.executionContext.gitPreflight.statusLines.join("\n")}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : null}

              <section className="panel">
                <h2>Injected Project Memory</h2>
                <div className="stack">
                  <div className="inline-meta">
                    {run.executionContext.memory.summary.map((line) => (
                      <span key={line} className="tag">
                        {line}
                      </span>
                    ))}
                  </div>
                  <pre className="code-block compact-code">{run.executionContext.memory.promptBlock}</pre>
                  <div className="memory-list">
                    {run.executionContext.memory.sources.map((source) => (
                      <div key={`${source.kind}-${source.path}`} className="memory-item">
                        <div className="inline-meta">
                          <span className="tag">{source.kind}</span>
                          <strong>{source.label}</strong>
                        </div>
                        <code>{source.path}</code>
                        <div className="muted">{source.snippet}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </>
          ) : null}

          {run.rawOutput ? (
            <section className="panel">
              <h2>Raw Output</h2>
              <pre className="code-block">{run.rawOutput}</pre>
            </section>
          ) : null}

          {run.gitDiff !== null ? (
            <section className="panel">
              <h2>Git Diff</h2>
              {run.gitDiff.trim() ? (
                <pre className="code-block">{run.gitDiff}</pre>
              ) : (
                <div className="empty">This run did not produce a git diff patch.</div>
              )}
            </section>
          ) : null}

          {run.gitStateBefore || run.gitStateAfter ? (
            <section className="panel">
              <h2>Git State Snapshot</h2>
              <div className="stack">
                {run.gitStateBefore ? (
                  <div>
                    <strong>Before</strong>
                    <pre className="code-block compact-code">
                      {JSON.stringify(run.gitStateBefore, null, 2)}
                    </pre>
                  </div>
                ) : null}
                {run.gitStateAfter ? (
                  <div>
                    <strong>After</strong>
                    <pre className="code-block compact-code">
                      {JSON.stringify(run.gitStateAfter, null, 2)}
                    </pre>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>

        <div className="stack">
          <section className="panel">
            <h2>Metadata</h2>
            <div className="inline-meta">
              <span className="tag">{run.roleName}</span>
              <span className="tag">{run.model}</span>
              <span className="tag">{run.status}</span>
            </div>
            <div className="stack">
              <div>
                <strong>Started</strong>
                <div className="muted">{formatDateTime(run.startedAt)}</div>
              </div>
              <div>
                <strong>Ended</strong>
                <div className="muted">{run.endedAt ? formatDateTime(run.endedAt) : "Still running"}</div>
              </div>
            </div>
            {run.rollbackAvailable ? <RollbackRunButton runId={run.id} /> : null}
          </section>

          <section className="panel">
            <h2>Artifacts</h2>
            {run.artifacts.length === 0 ? (
              <div className="empty">No persisted artifacts were recorded for this run.</div>
            ) : (
              <div className="run-list">
                {run.artifacts.map((artifact) => (
                  <div key={artifact.id} className="run-item">
                    <div className="inline-meta">
                      <span className="tag">{artifact.artifactType}</span>
                      <span className="tag">{formatTime(artifact.createdAt)}</span>
                    </div>
                    <strong>{artifact.title}</strong>
                    <code>{artifact.filePath}</code>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <h2>Command Runs</h2>
            {run.commandRuns.length === 0 ? (
              <div className="empty">This run did not execute any verification commands.</div>
            ) : (
              <div className="run-list">
                {run.commandRuns.map((commandRun) => (
                  <div key={commandRun.id} className="run-item">
                    <div className="inline-meta">
                      <span className={`tag ${commandRun.exitCode === 0 ? "good" : "bad"}`}>
                        exit {commandRun.exitCode}
                      </span>
                      <span className="tag">{commandRun.durationMs} ms</span>
                    </div>
                    <strong>{commandRun.command}</strong>
                    <div className="muted">{commandRun.cwd}</div>
                    {commandRun.stdoutPath ? <code>stdout: {commandRun.stdoutPath}</code> : null}
                    {commandRun.stderrPath ? <code>stderr: {commandRun.stderrPath}</code> : null}
                    {commandRun.stdout ? (
                      <div className="stack">
                        <strong>stdout</strong>
                        <pre className="code-block compact-code">{commandRun.stdout}</pre>
                      </div>
                    ) : null}
                    {commandRun.stderr ? (
                      <div className="stack">
                        <strong>stderr</strong>
                        <pre className="code-block compact-code">{commandRun.stderr}</pre>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
