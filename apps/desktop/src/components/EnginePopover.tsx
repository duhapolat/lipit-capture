import { Cpu, LoaderCircle, RefreshCw, X } from "lucide-react";
import type { EngineVersions } from "../types";

const engineNames = {
  ytDlp: "yt-dlp",
  ffmpeg: "FFmpeg",
  ffprobe: "FFprobe",
  deno: "Deno",
} as const;

export function EnginePopover({
  engines,
  updating,
  updateDisabled,
  availableEngineUpdate,
  message,
  onUpdate,
  onClose,
}: {
  engines: EngineVersions | null;
  updating: boolean;
  updateDisabled: boolean;
  availableEngineUpdate: string | null;
  message: string | null;
  onUpdate: () => void;
  onClose: () => void;
}) {
  return (
    <section className="engine-popover" aria-label="Medya motorları">
      <div className="engine-popover-head">
        <span className="side-icon"><Cpu size={17} /></span>
        <div>
          <strong>Medya motorları</strong>
          <span>Yerel araçların durumu</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Motor panelini kapat">
          <X size={15} />
        </button>
      </div>
      <div className="engine-list">
        {(Object.keys(engineNames) as (keyof typeof engineNames)[]).map((name) => (
          <div key={name}>
            <span>
              {engineNames[name]}
              {engines?.[name] && (
                <small title={engines[name] || ""}>
                  {engines[name]?.split(/\s+/).slice(0, 3).join(" ")}
                </small>
              )}
            </span>
            <b className={engines == null ? "" : engines[name] ? "ok" : "missing"}>
              {engines == null ? "Denetleniyor" : engines[name] ? "Hazır" : "Bulunamadı"}
            </b>
          </div>
        ))}
        <div>
          <span>
            yt-dlp-ejs
            <small>JS doğrulama çözücü</small>
          </span>
          <b className="ok">{engines?.ejs || "Gömülü"}</b>
        </div>
      </div>
      {availableEngineUpdate && (
        <p className="settings-message">Yeni yt-dlp sürümü mevcut: {availableEngineUpdate}</p>
      )}
      <button
        className="engine-update-button"
        type="button"
        onClick={onUpdate}
        disabled={updating || updateDisabled}
        title={updateDisabled ? "Aktif işlemler bitince güncelleyebilirsin" : undefined}
      >
        {updating ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}
        {updating ? "Güncelleniyor" : "yt-dlp güncelle"}
      </button>
      {message && <p className="settings-message">{message}</p>}
    </section>
  );
}
