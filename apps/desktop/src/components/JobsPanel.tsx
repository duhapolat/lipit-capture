import { ArrowDownToLine, FolderOpen, Play, RotateCcw, X } from "lucide-react";
import type { DownloadJob } from "../types";
import { isActive, remainingTime, statusLabels, transferSpeed } from "../lib/format";

export function JobsPanel({
  jobs,
  canRetry,
  onCancel,
  onReveal,
  onPlay,
  onRetry,
}: {
  jobs: DownloadJob[];
  canRetry: (job: DownloadJob) => boolean;
  onCancel: (job: DownloadJob) => void;
  onReveal: (job: DownloadJob) => void;
  onPlay: (job: DownloadJob) => void;
  onRetry: (job: DownloadJob) => void;
}) {
  const activeJobs = jobs.filter((job) => isActive(job.status));
  return (
    <section className={`workspace-side-card operations-card ${jobs.length ? "has-items" : ""}`}>
      <div className="workspace-side-head">
        <span><ArrowDownToLine size={19} /></span>
        <div>
          <h2>İşlemler</h2>
          <p>{activeJobs.length ? `${activeJobs.length} işlem sürüyor` : "Aktif işlem yok"}</p>
        </div>
      </div>
      {jobs.length ? (
        <div className="workspace-job-list">
          {jobs.slice(0, 6).map((job) => {
            const running = isActive(job.status);
            const details = running
              ? [transferSpeed(job.speedBytesPerSecond), remainingTime(job.etaSeconds)]
                  .filter(Boolean)
                  .join(" · ")
              : "";
            const name = job.outputPath.split(/[\\/]/).pop();
            return (
              <div className="workspace-job-item" key={job.id}>
                <div className="workspace-job-copy">
                  <strong title={job.outputPath}>{name}</strong>
                  <span>
                    {job.kind === "clip" ? "Klip" : "Video"} · {statusLabels[job.status]}
                    {details ? ` · ${details}` : ""}
                  </span>
                </div>
                <span className="job-actions">
                  {running && (
                    <button type="button" onClick={() => onCancel(job)} title="İptal et" aria-label={`${name} işlemini iptal et`}>
                      <X size={15} />
                    </button>
                  )}
                  {job.status === "completed" && (
                    <>
                      <button type="button" onClick={() => onPlay(job)} title="Oynat" aria-label={`${name} dosyasını oynat`}>
                        <Play size={14} />
                      </button>
                      <button type="button" onClick={() => onReveal(job)} title="Klasörde göster" aria-label={`${name} dosyasını klasörde göster`}>
                        <FolderOpen size={14} />
                      </button>
                    </>
                  )}
                  {job.status === "failed" && canRetry(job) && (
                    <button type="button" onClick={() => onRetry(job)} title="Tekrar dene" aria-label={`${name} işlemini tekrar dene`}>
                      <RotateCcw size={14} />
                    </button>
                  )}
                </span>
                <div
                  className="workspace-job-progress"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(job.progressPercent ?? 0)}
                  aria-label={`${name} ilerlemesi`}
                >
                  <span style={{ width: `${job.progressPercent ?? 0}%` }} />
                </div>
                <b>
                  {job.progressPercent != null
                    ? `${job.progressPercent.toFixed(0)}%`
                    : job.status === "completed"
                      ? "Tamam"
                      : ""}
                </b>
                {job.error && <p>{job.error.message}</p>}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="workspace-side-empty compact">
          <ArrowDownToLine size={21} />
          <span>İndirme ve klip işlemleri burada görünür.</span>
        </div>
      )}
    </section>
  );
}
