"use client";

import { useEffect, useState } from "react";

import { CLIENT_API_BASE_URL } from "../../../lib/client-api";
import { useLanguage } from "../../language-provider";

const API_BASE_URL = CLIENT_API_BASE_URL;

type LiveEvent = {
  type: string;
  timestamp: string;
  message?: string;
  roleName?: string;
  status?: string;
  outputSummary?: string;
  taskCode?: string;
  from?: string;
  to?: string;
  summary?: string;
  command?: string;
  exitCode?: number;
  durationMs?: number;
};

export function LiveActivity({ projectId }: { projectId: string }) {
  const { language } = useLanguage();
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connectionState, setConnectionState] = useState("connecting");
  const text =
    language === "zh"
      ? {
          connecting: "连接中",
          connected: "已连接",
          disconnected: "已断开",
          waiting: "等待实时活动...",
          noDetails: "暂无详情",
          transport: "实时流",
        }
      : {
          connecting: "connecting",
          connected: "connected",
          disconnected: "disconnected",
          waiting: "Waiting for live activity...",
          noDetails: "No details",
          transport: "SSE",
        };

  useEffect(() => {
    const source = new EventSource(`${API_BASE_URL}/projects/${projectId}/events`);

    source.onopen = () => {
      setConnectionState("connected");
    };

    source.onerror = () => {
      setConnectionState("disconnected");
    };

    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as LiveEvent;
      setEvents((current) => [event, ...current].slice(0, 20));
    };

    return () => {
      source.close();
    };
  }, [projectId]);

  return (
    <div className="stack">
      <div className="inline-meta">
        <span className={`tag ${connectionState === "connected" ? "good" : "warn"}`}>
          {connectionState === "connected"
            ? text.connected
            : connectionState === "disconnected"
              ? text.disconnected
              : text.connecting}
        </span>
        <span className="tag">{text.transport}</span>
      </div>
      {events.length === 0 ? (
        <div className="empty">{text.waiting}</div>
      ) : (
        <div className="run-list">
          {events.map((event, index) => (
            <div key={`${event.timestamp}-${index}`} className="run-item">
              <div className="inline-meta">
                <span className="tag">{event.type}</span>
                {event.taskCode ? <span className="tag">{event.taskCode}</span> : null}
                {event.roleName ? <span className="tag">{event.roleName}</span> : null}
                {event.status ? <span className="tag">{event.status}</span> : null}
              </div>
              <div className="muted">
                {event.message ??
                  event.summary ??
                  event.outputSummary ??
                  (event.command ? `${event.command} (${event.exitCode})` : text.noDetails)}
              </div>
              {event.from && event.to ? (
                <div className="inline-meta">
                  <span className="tag">
                    {event.from} {"->"} {event.to}
                  </span>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
