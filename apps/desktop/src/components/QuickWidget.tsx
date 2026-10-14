import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Check, CircleAlert, X, Zap } from "lucide-react";
import type { DownloadJob } from "../types";
import { isActive, remainingTime, statusLabels } from "../lib/format";

/**
 * Small always-on-top progress window. Before a job exists (while the
 * background service resolves the video) the window is keyed by the browser
 * candidate id and shows a preparing state.
 */
export function QuickWidget({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<DownloadJob | null>(null);
  const [widgetError, setWidgetError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("widget-mode");
    document.body.classList.add("widget-mode");
    return () => {
      document.documentElement.classList.remove("widget-mode");
      document.body.classList.remove("widget-mode");
    };
  }, []);

  useEffect(() => {
    let alive = true;
    invoke<DownloadJob[]>("list_jobs")
      .then((jobs) => {
        if (alive) setJob(jobs.find((item) => item.id === jobId) ?? null);
      })
      .catch(() => {});
    const subscription = listen<DownloadJob>("job-update", ({ payload }) => {
      if (alive && payload.id === jobId) setJob(payload);
    }).catch(() => () => {});
    const failureSubscription = listen<string>("quick-widget-failed", ({ payload }) => {
      if (alive) setWidgetError(payload);
    }).catch(() => () => {});
    return () => {
      alive = false;
      subscription.then((unlisten) => unlisten());
      failureSubscription.then((unlisten) => unlisten());
    };
  }, [jobId]);

  useEffect(() => {
    if (!job || isActive(job.status)) return;
    const delay = job.status === "failed" ? 6_000 : 1_800;
    const timer = window.setTimeout(() => {
      void invoke("close_quick_widget", { jobId });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [job, jobId]);

  useEffect(() => {
    if (!widgetError) return;
    const timer = window.setTimeout(() => {
      void invoke("close_quick_widget", { jobId });
    }, 6_000);
    return () => window.clearTimeout(timer);
  }, [jobId, widgetError]);

  const percent = job?.status === "completed" ? 100 : job?.progressPercent ?? 0;
  const filename = job?.outputPath.split(/[\\/]/).pop() || "Video hazırlanıyor";
  const widgetFailed = Boolean(
    widgetError || job?.status === "failed" || job?.status === "cancelled",
  );
  const eta = job && isActive(job.status) ? remainingTime(job.etaSeconds) : null;

  return (
    <main className="quick-widget-shell" data-tauri-drag-region>
      <div className="quick-widget-head" data-tauri-drag-region>
        <span className={`quick-widget-icon ${job?.status ?? "queued"}`}>
          {widgetFailed ? (
            <CircleAlert size={17} />
          ) : job?.status === "completed" ? (
            <Check size={17} />
          ) : (
            <Zap size={17} />
          )}
        </span>
        <div>
          <strong>{job?.kind === "clip" ? "Hızlı klip" : "Hızlı indirme"}</strong>
          <span title={filename}>{filename}</span>
        </div>
        <b>{widgetError ? "!" : `${Math.round(percent)}%`}</b>
        {job && isActive(job.status) && (
          <button
            type="button"
            onClick={() => void invoke("cancel_download", { jobId })}
            title="İşlemi iptal et"
            aria-label="İşlemi iptal et"
          >
            <X size={15} />
          </button>
        )}
        {(widgetFailed || !job) && (
          <button
            type="button"
            onClick={() => void invoke("close_quick_widget", { jobId })}
            title="Pencereyi kapat"
            aria-label="Pencereyi kapat"
          >
            <X size={15} />
          </button>
        )}
      </div>
      <div className="quick-widget-progress">
        <div
          className={!job || (isActive(job.status) && percent <= 0) ? "indeterminate" : ""}
          style={{ width: `${Math.max(2, percent)}%` }}
        />
      </div>
      <div className="quick-widget-status" role="status" aria-live="polite">
        <span>
          {widgetError
            ? "İşlem başlatılamadı"
            : job
              ? statusLabels[job.status]
              : "Video çözümleniyor"}
          {eta ? ` · ${eta}` : ""}
        </span>
        {(widgetError || job?.error) && <span>{widgetError || job?.error?.message}</span>}
      </div>
    </main>
  );
}
