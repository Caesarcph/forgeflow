export type ProjectEvent =
  | {
      type: "connected";
      projectId: string;
      timestamp: string;
      message: string;
    }
  | {
      type: "task_transition";
      projectId: string;
      timestamp: string;
      taskId: string;
      taskCode: string;
      from: string;
      to: string;
      summary: string;
    }
  | {
      type: "task_run";
      projectId: string;
      timestamp: string;
      taskId: string;
      roleName: string;
      status: string;
      outputSummary: string;
    }
  | {
      type: "command_run";
      projectId: string;
      timestamp: string;
      taskId: string;
      command: string;
      exitCode: number;
      durationMs: number;
    }
  | {
      type: "info";
      projectId: string;
      timestamp: string;
      message: string;
    };

type ProjectListener = (event: ProjectEvent) => void;

const listeners = new Map<string, Set<ProjectListener>>();

export function publishProjectEvent(event: ProjectEvent) {
  const projectListeners = listeners.get(event.projectId);

  if (!projectListeners) {
    return;
  }

  for (const listener of projectListeners) {
    listener(event);
  }
}

export function subscribeToProjectEvents(projectId: string, listener: ProjectListener) {
  const projectListeners = listeners.get(projectId) ?? new Set<ProjectListener>();
  projectListeners.add(listener);
  listeners.set(projectId, projectListeners);

  return () => {
    const activeListeners = listeners.get(projectId);

    if (!activeListeners) {
      return;
    }

    activeListeners.delete(listener);

    if (activeListeners.size === 0) {
      listeners.delete(projectId);
    }
  };
}
