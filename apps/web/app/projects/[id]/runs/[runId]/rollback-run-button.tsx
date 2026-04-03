"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { CLIENT_API_BASE_URL } from "../../../../../lib/client-api";
import { parseJsonResponse, readApiError } from "../../../../../lib/http";

const API_BASE_URL = CLIENT_API_BASE_URL;

export function RollbackRunButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("Rollback restores only the files captured in this run's rollback manifest.");

  async function handleRollback() {
    setPending(true);
    setMessage("Rolling back this run...");

    try {
      const response = await fetch(`${API_BASE_URL}/runs/${runId}/rollback`, {
        method: "POST",
      });
      const payload = await parseJsonResponse<{ error?: string; message?: string }>(response);

      if (!response.ok) {
        throw new Error(readApiError(payload, "Rollback failed"));
      }

      setMessage("Rollback completed.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Rollback failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="stack">
      <div className="feedback">{message}</div>
      <button className="button ghost" type="button" onClick={handleRollback} disabled={pending}>
        {pending ? "Rolling Back..." : "Rollback This Run"}
      </button>
    </div>
  );
}
