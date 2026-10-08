import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  ArrowDownToLine,
  Check,
  CircleAlert,
  Clock3,
  Clipboard,
  Clapperboard,
  Cookie,
  Cpu,
  Film,
  FileVideo,
  FolderOpen,
  Globe2,
  History as HistoryIcon,
  Keyboard,
  Link2,
  ListVideo,
  LoaderCircle,
  Play,
  Puzzle,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Scissors,
  Square,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import "./App.css";

const LIPIT_VERSION = __LIPIT_VERSION__;
const RUNNING_IN_TAURI = "__TAURI_INTERNALS__" in window;
const versionParts = LIPIT_VERSION.match(/^(\d+\.\d+)\.0-beta\.(\d+)$/);
const LIPIT_DISPLAY_VERSION = versionParts
  ? `${versionParts[1]} BETA ${versionParts[2]}`
  : LIPIT_VERSION.toUpperCase();

type AppError = { code: string; message: string };
type QualityProfile = {
  height: number | null;
  label: string;
  fps: number | null;
};
type ResolvedMedia = {
  url: string;
  title: string;
  uploader: string | null;
  durationMs: number | null;
  thumbnail: string | null;
  profiles: QualityProfile[];
  drm: boolean;
  direct: boolean;
  isLive: boolean;
  refreshUrl: string | null;
  requestContext: RequestContext;
};
type RequestContext = {
  referer: string | null;
  origin: string | null;
  userAgent: string | null;
};
type JobStatus =
  | "queued"
  | "resolving"
  | "downloading"
  | "analyzing"
  | "encoding"
  | "saving"
  | "completed"
  | "failed"
  | "cancelled";
type DownloadJob = {
  id: string;
  kind: "download" | "clip";
  sourceUrl: string;
  qualityHeight: number | null;
  startMs: number | null;
  endMs: number | null;
  clipMode: "fast" | "precise" | null;
  outputPath: string;
  status: JobStatus;
  progressPercent: number | null;
  speedBytesPerSecond: number | null;
  etaSeconds: number | null;
  error: AppError | null;
};
type EngineVersions = {
  ytDlp: string | null;
  ffmpeg: string | null;
  ffprobe: string | null;
  deno: string | null;
  ytDlpManaged: boolean;
  ejs: string;
  poTokenPluginsDir: string;
};
type CookieBrowser = "brave" | "chrome" | "edge";
type AppSettings = {
  onboardingCompleted: boolean;
  quickProfile: {
    destinationMode: "ask" | "folder";
    downloadDirectory: string | null;
    clipDurationMs: number;
    qualityHeight: number | null;
    clipMode: ClipMode;
  };
  compatibility: {
    cookiesEnabled: boolean;
    cookieBrowser: CookieBrowser;
    remoteEjsEnabled: boolean;
    poTokenProvidersEnabled: boolean;
  };
};
type EngineUpdateResult = {
  previousVersion: string | null;
  currentVersion: string;
  updated: boolean;
};
type NativeBridgeRepairResult = {
  hostPath: string;
  manifestPath: string;
  browsersRegistered: number;
};
type HistoryEntry = {
  id: string;
  kind: "download" | "clip";
  title: string;
  sourceHost: string;
  outputPath: string;
  completedAtMs: number;
  sizeBytes: number;
  fileExists: boolean;
  qualityHeight: number | null;
  startMs: number | null;
  endMs: number | null;
  clipMode: "fast" | "precise" | null;
};
type CaptureAction = "download" | "clip" | "quick_download" | "quick_clip";
type ClipMode = "fast" | "precise";
type MediaCandidate = {
  id: string;
  tabId: number;
  pageUrl: string;
  pageTitle?: string;
  mediaUrl?: string;
  source: "dom" | "network" | "extractor";
  protocol: "http" | "hls" | "dash" | "blob" | "unknown";
  mimeType?: string;
  width?: number;
  height?: number;
  fps?: number;
  durationMs?: number;
  currentTimeMs?: number;
  referer?: string;
  origin?: string;
  userAgent?: string;
  drm?: boolean;
};
type StoredCandidate = {
  action: CaptureAction;
  candidate: MediaCandidate;
  receivedAtMs: number;
};

const statusLabels: Record<JobStatus, string> = {
  queued: "Sırada",
  resolving: "Medya çözümleniyor",
  downloading: "İndiriliyor",
  analyzing: "Dosya inceleniyor",
  encoding: "MP4 hazırlanıyor",
  saving: "Kaydediliyor",
  completed: "Tamamlandı",
  failed: "Başarısız",
  cancelled: "İptal edildi",
};
const active = (status: JobStatus) =>
  !["completed", "failed", "cancelled"].includes(status);
const errorMessage = (error: unknown) =>
  typeof error === "object" && error !== null && "message" in error
    ? String((error as AppError).message)
    : "İşlem tamamlanamadı. Bağlantıyı ve medya araçlarını kontrol edin.";
const cleanFilename = (title: string, suffix = "") =>
  `${
    title
      .normalize("NFKC")
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "video"
  }${suffix}_${new Date().toISOString().slice(0, 10)}.mp4`;
const duration = (ms: number | null) =>
  ms == null
    ? "Süre bilinmiyor"
    : [
        Math.floor(ms / 3600000),
        Math.floor((ms % 3600000) / 60000),
        Math.floor((ms % 60000) / 1000),
      ]
        .map((part) => String(part).padStart(2, "0"))
        .join(":");
const timecode = (ms: number) => {
  const safe = Math.max(0, Math.round(ms));
  const hours = Math.floor(safe / 3600000);
  const minutes = Math.floor((safe % 3600000) / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  const milliseconds = safe % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}:${String(milliseconds).padStart(3, "0")}`;
};
const parseTimecode = (value: string): number | null => {
  const match = value.trim().match(/^(\d{1,4}):([0-5]?\d):([0-5]?\d):(\d{1,3})$/);
  if (!match) return null;
  const [, hours, minutes, seconds, milliseconds] = match;
  return (
    Number(hours) * 3_600_000 +
    Number(minutes) * 60_000 +
    Number(seconds) * 1_000 +
    Number(milliseconds)
  );
};
type TimecodeInputProps = {
  value: number;
  onCommit: (value: number) => void;
  label: string;
};
function TimecodeInput({ value, onCommit, label }: TimecodeInputProps) {
  const [draft, setDraft] = useState(() => timecode(value));

  useEffect(() => setDraft(timecode(value)), [value]);

  const commit = () => {
    const parsed = parseTimecode(draft);
    if (parsed == null) {
      setDraft(timecode(value));
      return;
    }
    onCommit(parsed);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      spellCheck={false}
      value={draft}
      placeholder="00:00:00:000"
      aria-label={`${label}, saat:dakika:saniye:milisaniye`}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(timecode(value));
          event.currentTarget.blur();
        }
      }}
    />
  );
}
const fileSize = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${Math.max(1, bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
};
const historyDate = (milliseconds: number) =>
  new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(milliseconds));

const clipPresets = [15_000, 30_000, 45_000, 60_000, 120_000, 300_000] as const;
const qualityPresets = [null, 2160, 1440, 1080, 720, 480] as const;
const clipPresetLabel = (milliseconds: number) =>
  milliseconds >= 60_000 ? `${milliseconds / 60_000} dk` : `${milliseconds / 1000} sn`;
const qualityPresetLabel = (height: number | null) =>
  height == null ? "En iyi" : `${height}p`;
const quickQualityHeight = (
  profiles: QualityProfile[],
  preferredHeight: number | null,
) => {
  if (preferredHeight == null) return profiles[0]?.height ?? null;
  const available = profiles
    .map((profile) => profile.height)
    .filter((height): height is number => height != null)
    .sort((left, right) => right - left);
  return (
    available.find((height) => height <= preferredHeight) ??
    available[available.length - 1] ??
    null
  );
};
const initialClipRange = (
  durationMs: number | null,
  requestedStart = 0,
  clipDurationMs = 30_000,
) => {
  const knownEnd = durationMs ?? requestedStart + clipDurationMs;
  const startMs = Math.min(
    Math.max(0, requestedStart),
    Math.max(0, knownEnd - 100),
  );
  return {
    startMs,
    endMs: Math.min(knownEnd, Math.max(startMs + 100, startMs + clipDurationMs)),
  };
};

const invokeWithTimeout = async <T,>(
  command: string,
  args: Record<string, unknown>,
  milliseconds = 24_000,
): Promise<T> => {
  let timer = 0;
  try {
    return await Promise.race([
      invoke<T>(command, args),
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(
          () => {
            void invoke("cancel_resolution").catch(() => {});
            reject({
              code: "RESOLVE_TIMEOUT",
              message: "Video çözümlenemedi. Bağlantıyı kontrol edip tekrar deneyin.",
            });
          },
          milliseconds,
        );
      }),
    ]);
  } finally {
    window.clearTimeout(timer);
  }
};

const defaultSettings: AppSettings = {
  onboardingCompleted: false,
  quickProfile: {
    destinationMode: "ask",
    downloadDirectory: null,
    clipDurationMs: 30_000,
    qualityHeight: null,
    clipMode: "fast",
  },
  compatibility: {
    cookiesEnabled: false,
    cookieBrowser: "chrome",
    remoteEjsEnabled: false,
    poTokenProvidersEnabled: false,
  },
};

const DESIGN_PREVIEW =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).has("design-preview");
const DESIGN_PREVIEW_THUMBNAIL = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
    <defs><linearGradient id="g" x1="0" x2="1"><stop stop-color="#17222d"/><stop offset="1" stop-color="#3b2018"/></linearGradient></defs>
    <rect width="640" height="360" fill="url(#g)"/><rect x="28" y="28" width="584" height="304" rx="16" fill="#111820" stroke="#ff7a45" stroke-opacity=".38"/>
    <circle cx="320" cy="170" r="48" fill="#ff7a45" fill-opacity=".92"/><path d="M305 142 350 170 305 198Z" fill="#16100d"/>
    <text x="320" y="270" fill="#f4f6f8" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="30" font-weight="700">Lipit Studio</text>
  </svg>
`)}`;
const DESIGN_PREVIEW_MEDIA: ResolvedMedia = {
  url: "https://www.youtube.com/watch?v=preview",
  title: "Windows 11 Sandım! Meğer Linux 11’miş",
  uploader: "Sefer Döngel",
  durationMs: 1_210_000,
  thumbnail: DESIGN_PREVIEW_THUMBNAIL,
  profiles: [
    { height: null, label: "En iyi kalite", fps: 60 },
    { height: 1080, label: "1080p (Full HD)", fps: 60 },
    { height: 720, label: "720p", fps: 60 },
    { height: 480, label: "480p", fps: 30 },
  ],
  drm: false,
  direct: false,
  isLive: false,
  refreshUrl: null,
  requestContext: { referer: null, origin: null, userAgent: null },
};

type ProfileSettingsProps = {
  value: AppSettings;
  onChange: (settings: AppSettings) => void;
  onChooseDirectory: () => void;
  showAdvanced: boolean;
  pluginDirectory?: string;
  onRepairNativeBridge?: () => void;
  bridgeRepairing?: boolean;
};

function ProfileSettings({
  value,
  onChange,
  onChooseDirectory,
  showAdvanced,
  pluginDirectory,
  onRepairNativeBridge,
  bridgeRepairing = false,
}: ProfileSettingsProps) {
  const updateQuickProfile = (changes: Partial<AppSettings["quickProfile"]>) =>
    onChange({
      ...value,
      quickProfile: { ...value.quickProfile, ...changes },
    });
  const updateCompatibility = (
    changes: Partial<AppSettings["compatibility"]>,
  ) =>
    onChange({
      ...value,
      compatibility: { ...value.compatibility, ...changes },
    });

  return (
    <div className="profile-settings-form">
      <section className="settings-group">
        <div className="settings-group-head">
          <span className="side-icon"><FolderOpen size={17} /></span>
          <div>
            <h3>Kayıt konumu</h3>
            <p>Hızlı işlemlerde dosyanın nereye kaydedileceğini seç.</p>
          </div>
        </div>
        <div className="settings-choice-grid two-columns">
          <button
            type="button"
            className={value.quickProfile.destinationMode === "ask" ? "selected" : ""}
            onClick={() => updateQuickProfile({ destinationMode: "ask" })}
          >
            Her seferinde sor
          </button>
          <button
            type="button"
            className={value.quickProfile.destinationMode === "folder" ? "selected" : ""}
            onClick={onChooseDirectory}
          >
            <FolderOpen size={14} /> Sabit klasör
          </button>
        </div>
        {value.quickProfile.destinationMode === "folder" && (
          <button
            className="selected-folder"
            type="button"
            onClick={onChooseDirectory}
            title={value.quickProfile.downloadDirectory || "Klasör seçilmedi"}
          >
            {value.quickProfile.downloadDirectory || "Klasör seçilmedi"}
          </button>
        )}
      </section>

      <section className="settings-group">
        <div className="settings-group-head">
          <span className="side-icon"><Film size={17} /></span>
          <div>
            <h3>Hızlı indirme kalitesi</h3>
            <p>Seçilen çözünürlük yoksa en yakın düşük kalite kullanılır.</p>
          </div>
        </div>
        <div className="settings-choice-grid quality-grid">
          {qualityPresets.map((quality) => (
            <button
              type="button"
              key={quality ?? "best"}
              className={value.quickProfile.qualityHeight === quality ? "selected" : ""}
              onClick={() => updateQuickProfile({ qualityHeight: quality })}
            >
              {qualityPresetLabel(quality)}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-group">
        <div className="settings-group-head">
          <span className="side-icon"><Zap size={17} /></span>
          <div>
            <h3>Hızlı klip</h3>
            <p>⚡ düğmesi videonun mevcut anından bu ayarlarla klip alır.</p>
          </div>
        </div>
        <div className="settings-inline-label">
          <strong>Klip süresi</strong>
          <span>{clipPresetLabel(value.quickProfile.clipDurationMs)}</span>
        </div>
        <div className="settings-choice-grid duration-grid">
          {clipPresets.map((milliseconds) => (
            <button
              type="button"
              key={milliseconds}
              className={value.quickProfile.clipDurationMs === milliseconds ? "selected" : ""}
              onClick={() => updateQuickProfile({ clipDurationMs: milliseconds })}
            >
              {clipPresetLabel(milliseconds)}
            </button>
          ))}
        </div>
        <div className="settings-choice-grid two-columns clip-method-choice">
          <button
            type="button"
            className={value.quickProfile.clipMode === "fast" ? "selected" : ""}
            onClick={() => updateQuickProfile({ clipMode: "fast" })}
          >
            Hızlı kesim
            <small>Daha çabuk hazırlanır</small>
          </button>
          <button
            type="button"
            className={value.quickProfile.clipMode === "precise" ? "selected" : ""}
            onClick={() => updateQuickProfile({ clipMode: "precise" })}
          >
            Hassas kesim
            <small>Seçilen kareye daha yakın</small>
          </button>
        </div>
      </section>

      {showAdvanced && (
        <section className="settings-group advanced-settings-group">
          <div className="settings-group-head">
            <span className="side-icon"><Cpu size={17} /></span>
            <div>
              <h3>Gelişmiş uyumluluk</h3>
              <p>Yalnız belirli videolar gerektiğinde etkinleştir.</p>
            </div>
          </div>
          <label className="setting-row">
            <input
              type="checkbox"
              checked={value.compatibility.cookiesEnabled}
              onChange={(event) =>
                updateCompatibility({ cookiesEnabled: event.target.checked })
              }
            />
            <span className="setting-icon"><Cookie size={14} /></span>
            <span>
              <strong>Tarayıcı çerezlerini kullan</strong>
              <small>Oturum gerektiren ve erişim hakkın bulunan videolar için</small>
            </span>
          </label>
          {value.compatibility.cookiesEnabled && (
            <label className="browser-select">
              <span>Çerez kaynağı</span>
              <select
                value={value.compatibility.cookieBrowser}
                onChange={(event) =>
                  updateCompatibility({ cookieBrowser: event.target.value as CookieBrowser })
                }
              >
                <option value="chrome">Chrome</option>
                <option value="edge">Edge</option>
                <option value="brave">Brave</option>
              </select>
            </label>
          )}
          <label className="setting-row">
            <input
              type="checkbox"
              checked={value.compatibility.remoteEjsEnabled}
              onChange={(event) =>
                updateCompatibility({ remoteEjsEnabled: event.target.checked })
              }
            />
            <span className="setting-icon"><RefreshCw size={14} /></span>
            <span>
              <strong>Güncel EJS yedeği</strong>
              <small>Gerektiğinde resmi yt-dlp-ejs bileşenini kullanır</small>
            </span>
          </label>
          <label className="setting-row">
            <input
              type="checkbox"
              checked={value.compatibility.poTokenProvidersEnabled}
              onChange={(event) =>
                updateCompatibility({ poTokenProvidersEnabled: event.target.checked })
              }
            />
            <span className="setting-icon"><Puzzle size={14} /></span>
            <span>
              <strong>PO Token sağlayıcıları</strong>
              <small>Uygulama klasöründeki uyumlu yt-dlp eklentilerini yükler</small>
            </span>
          </label>
          {value.compatibility.poTokenProvidersEnabled && pluginDirectory && (
            <code className="plugin-path" title={pluginDirectory}>{pluginDirectory}</code>
          )}
          <p className="cookie-note">
            Uzantı çerez göndermez. Bu seçenek yalnız seçilen tarayıcının yerel
            oturumunu işlem sırasında kullanır.
          </p>
          {onRepairNativeBridge && (
            <button
              className="settings-repair-button"
              type="button"
              onClick={onRepairNativeBridge}
              disabled={bridgeRepairing}
            >
              <RefreshCw className={bridgeRepairing ? "spin" : ""} size={15} />
              {bridgeRepairing
                ? "Tarayıcı bağlantısı onarılıyor"
                : "Tarayıcı bağlantısını onar"}
            </button>
          )}
        </section>
      )}
    </div>
  );
}

function QuickWidget({ jobId }: { jobId: string }) {
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
    if (!job || active(job.status)) return;
    const delay = job.status === "failed" ? 4_500 : 1_500;
    const timer = window.setTimeout(() => {
      void invoke("close_quick_widget", { jobId });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [job, jobId]);

  useEffect(() => {
    if (!widgetError) return;
    const timer = window.setTimeout(() => {
      void invoke("close_quick_widget", { jobId });
    }, 4_500);
    return () => window.clearTimeout(timer);
  }, [jobId, widgetError]);

  const percent = job?.status === "completed" ? 100 : job?.progressPercent ?? 0;
  const filename = job?.outputPath.split(/[\\/]/).pop() || "Hızlı işlem hazırlanıyor";
  const widgetFailed = Boolean(
    widgetError || job?.status === "failed" || job?.status === "cancelled",
  );

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
        {job && active(job.status) && (
          <button
            type="button"
            onClick={() => void invoke("cancel_download", { jobId })}
            title="İşlemi iptal et"
            aria-label="İşlemi iptal et"
          >
            <X size={15} />
          </button>
        )}
      </div>
      <div className="quick-widget-progress">
        <div
          className={job && active(job.status) && percent <= 0 ? "indeterminate" : ""}
          style={{ width: `${Math.max(2, percent)}%` }}
        />
      </div>
      <div className="quick-widget-status">
        <span>{widgetError ? "İşlem başlatılamadı" : job ? statusLabels[job.status] : "İşlem hazırlanıyor"}</span>
        {(widgetError || job?.error) && <span>{widgetError || job?.error?.message}</span>}
      </div>
    </main>
  );
}

function MainApp() {
  const urlInputRef = useRef<HTMLInputElement>(null);
  const urlFormRef = useRef<HTMLFormElement>(null);
  const [url, setUrl] = useState(DESIGN_PREVIEW ? DESIGN_PREVIEW_MEDIA.url : "");
  const [media, setMedia] = useState<ResolvedMedia | null>(
    DESIGN_PREVIEW ? DESIGN_PREVIEW_MEDIA : null,
  );
  const [height, setHeight] = useState<number | null>(DESIGN_PREVIEW ? 1080 : null);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [engines, setEngines] = useState<EngineVersions | null>(null);
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captured, setCaptured] = useState<StoredCandidate | null>(null);
  const [detected, setDetected] = useState<StoredCandidate[]>([]);
  const [clipMode, setClipMode] = useState<ClipMode>("fast");
  const [startMs, setStartMs] = useState(DESIGN_PREVIEW ? 30_000 : 0);
  const [endMs, setEndMs] = useState(DESIGN_PREVIEW ? 60_000 : 30_000);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(defaultSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [engineUpdating, setEngineUpdating] = useState(false);
  const [bridgeRepairing, setBridgeRepairing] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [preview, setPreview] = useState<{ entry: HistoryEntry; source: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [workspacePanelOpen, setWorkspacePanelOpen] = useState(false);
  const [enginePanelOpen, setEnginePanelOpen] = useState(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await invoke<HistoryEntry[]>("list_history"));
    } catch {
      // History is secondary to the active download flow.
    }
  }, []);

  const setResolvedMedia = useCallback(
    (
      result: ResolvedMedia,
      requestedStart = 0,
      clipDurationMs = 30_000,
    ) => {
      setMedia(result);
      setHeight(result.profiles[0]?.height ?? null);
      const range = initialClipRange(result.durationMs, requestedStart, clipDurationMs);
      setStartMs(range.startMs);
      setEndMs(range.endMs);
    },
    [],
  );

  const enqueue = useCallback(async (
    kind: "download" | "clip",
    targetMedia: ResolvedMedia,
    targetHeight: number | null,
    range: { startMs: number; endMs: number } | null,
    activeSettings: AppSettings,
    activeClipMode: ClipMode,
  ) => {
    setError(null);
    setSaving(true);
    try {
      const filename = cleanFilename(targetMedia.title, kind === "clip" ? "_clip" : "");
      if (activeSettings.quickProfile.destinationMode === "folder") {
        await invoke("save_settings", { settings: activeSettings });
      }
      const outputPath =
        activeSettings.quickProfile.destinationMode === "folder"
          ? await invoke<string>("quick_output_path", { suggestedFilename: filename })
          : await save({
              title: kind === "clip" ? "Klibi MP4 olarak kaydet" : "MP4 dosyasını kaydet",
              defaultPath: filename,
              filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
            });
      if (!outputPath) return null;
      const job = await invoke<DownloadJob>(
        kind === "clip" ? "start_clip" : "start_download",
        {
          request: {
            url: targetMedia.url,
            qualityHeight: targetHeight,
            outputPath,
            direct: targetMedia.direct,
            refreshUrl: targetMedia.refreshUrl,
            ...(kind === "clip" && range
              ? { startMs: range.startMs, endMs: range.endMs, mode: activeClipMode }
              : {}),
            knownDurationMs: targetMedia.durationMs,
            requestContext: targetMedia.requestContext,
          },
        },
      );
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      return job;
    } catch (cause) {
      setError(errorMessage(cause));
      return null;
    } finally {
      setSaving(false);
    }
  }, []);

  const openDetectedCandidate = useCallback(async (stored: StoredCandidate) => {
    const candidateUrl = stored.candidate.mediaUrl || stored.candidate.pageUrl;
    const isClip = stored.action === "clip" || stored.action === "quick_clip";
    const isQuick = stored.action === "quick_download" || stored.action === "quick_clip";
    if (!isQuick) void invoke("show_main_window");
    setCaptured(stored);
    setUrl(candidateUrl);
    setError(null);
    setMedia(null);
    setResolving(true);
    let quickWidgetId: string | null = null;
    try {
      const activeSettings = await invoke<AppSettings>("get_settings").catch(
        () => settingsRef.current,
      );
      setSettings(activeSettings);
      if (isQuick && activeSettings.onboardingCompleted) {
        quickWidgetId = stored.candidate.id;
        await invoke("open_quick_widget", { jobId: quickWidgetId });
        await invoke("hide_main_window");
      }
      const result = await invokeWithTimeout<ResolvedMedia>("resolve_detected_candidate", {
        candidate: stored.candidate,
      });
      const requestedStart = isClip ? stored.candidate.currentTimeMs ?? 0 : 0;
      const range = initialClipRange(
        result.durationMs,
        requestedStart,
        activeSettings.quickProfile.clipDurationMs,
      );
      setResolvedMedia(
        result,
        requestedStart,
        activeSettings.quickProfile.clipDurationMs,
      );
      if (isQuick) {
        if (!activeSettings.onboardingCompleted) {
          setSettingsDraft(activeSettings);
          setOnboardingOpen(true);
          setError("Hızlı işlemi kullanmadan önce profil ayarlarını kaydet.");
          await invoke("show_main_window");
          return;
        }
        const job = await enqueue(
          isClip ? "clip" : "download",
          result,
          quickQualityHeight(
            result.profiles,
            activeSettings.quickProfile.qualityHeight,
          ),
          isClip ? range : null,
          activeSettings,
          activeSettings.quickProfile.clipMode,
        );
        if (job) {
          await invoke("open_quick_widget", { jobId: job.id });
          if (quickWidgetId) {
            await invoke("close_quick_widget", { jobId: quickWidgetId });
          }
        } else if (quickWidgetId) {
          await invoke("fail_quick_widget", {
            widgetId: quickWidgetId,
            message: "İşlem başlatılamadı. Bağlantıyı ve hızlı profil ayarlarını kontrol edin.",
          });
        }
      }
    } catch (cause) {
      const message = errorMessage(cause);
      setError(message);
      if (quickWidgetId) {
        await invoke("fail_quick_widget", {
          widgetId: quickWidgetId,
          message,
        }).catch(() => {});
      }
    } finally {
      setResolving(false);
    }
  }, [enqueue, setResolvedMedia]);

  const openDetectedCandidateRef = useRef(openDetectedCandidate);
  openDetectedCandidateRef.current = openDetectedCandidate;

  useEffect(() => {
    let alive = true;
    invoke<EngineVersions>("engine_versions")
      .then((result) => {
        if (alive) setEngines(result);
      })
      .catch(() => {
        if (alive)
          setEngines({
            ytDlp: null,
            ffmpeg: null,
            ffprobe: null,
            deno: null,
            ytDlpManaged: false,
            ejs: "Bilinmiyor",
            poTokenPluginsDir: "",
          });
      });
    invoke<AppSettings>("get_settings")
      .then((result) => {
        if (alive) {
          setSettings(result);
          setSettingsDraft(result);
          setClipMode(result.quickProfile.clipMode);
          setOnboardingOpen(!result.onboardingCompleted);
        }
      })
      .catch(() => {
        if (alive) setOnboardingOpen(RUNNING_IN_TAURI);
      });
    invoke<DownloadJob[]>("list_jobs")
      .then((result) => {
        if (alive) setJobs(result);
      })
      .catch(() => {});
    void refreshHistory();
    const subscription = listen<DownloadJob>("job-update", ({ payload }) => {
      if (alive) {
        setJobs((current) => [
          payload,
          ...current.filter((job) => job.id !== payload.id),
        ]);
        if (payload.status === "completed") void refreshHistory();
      }
    }).catch(() => () => {});
    let polling = false;
    const receiveCandidates = async () => {
      if (!alive || polling) return;
      polling = true;
      try {
        const incoming = await invoke<StoredCandidate[]>(
          "drain_detected_candidates",
        );
        const fresh = [...incoming].reverse();
        if (alive && fresh.length) {
          setDetected((current) =>
            [...fresh, ...current]
              .filter(
                (item, index, all) =>
                  all.findIndex(
                    (other) => other.candidate.id === item.candidate.id,
                  ) === index,
              )
              .slice(0, 8),
          );
          const newest = fresh[0];
          if (newest) void openDetectedCandidateRef.current(newest);
        }
      } catch {
        // The bridge can be empty before the extension is installed.
      } finally {
        polling = false;
      }
    };
    void receiveCandidates();
    const candidateTimer = window.setInterval(receiveCandidates, 1200);
    return () => {
      alive = false;
      window.clearInterval(candidateTimer);
      subscription.then((unlisten) => unlisten());
    };
  }, [refreshHistory]);

  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMedia(null);
    setCaptured(null);
    setResolving(true);
    try {
      const result = await invokeWithTimeout<ResolvedMedia>("resolve_media", {
        url: url.trim(),
      });
      setResolvedMedia(
        result,
        0,
        settings.quickProfile.clipDurationMs,
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setResolving(false);
    }
  }

  async function cancelResolve() {
    await invoke("cancel_resolution").catch(() => {});
    setResolving(false);
    setError("Çözümleme durduruldu. Başka bir bağlantı deneyebilirsiniz.");
  }

  async function paste() {
    try {
      setUrl(await navigator.clipboard.readText());
    } catch {
      setError("Panoya erişilemedi. Bağlantıyı alana yapıştırabilirsiniz.");
    }
  }

  async function download() {
    if (!media) return;
    if (media.isLive) {
      setError("Canlı yayınlarda tamamını indirmek yerine süreli bir klip oluşturun.");
      return;
    }
    await enqueue("download", media, height, null, settings, clipMode);
  }

  async function createClip() {
    if (!media) return;
    if (endMs <= startMs) {
      setError("Klip bitiş zamanı başlangıçtan sonra olmalıdır.");
      return;
    }
    await enqueue(
      "clip",
      media,
      height,
      { startMs, endMs },
      settings,
      clipMode,
    );
  }

  async function chooseDownloadDirectory() {
    try {
      const selected = await open({
        title: "Hızlı indirme klasörünü seç",
        directory: true,
        multiple: false,
      });
      if (typeof selected === "string") {
        setSettingsDraft((current) => ({
          ...current,
          quickProfile: {
            ...current.quickProfile,
            destinationMode: "folder",
            downloadDirectory: selected,
          },
        }));
      }
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function copyDiagnostics() {
    const diagnostics = {
      lipitVersion: LIPIT_VERSION,
      platform: navigator.platform,
      engines: engines
        ? {
            ytDlp: engines.ytDlp,
            ffmpeg: engines.ffmpeg,
            ffprobe: engines.ffprobe,
            deno: engines.deno,
            ejs: engines.ejs,
            ytDlpManaged: engines.ytDlpManaged,
          }
        : null,
      compatibility: {
        cookiesEnabled: settingsDraft.compatibility.cookiesEnabled,
        cookieBrowser: settingsDraft.compatibility.cookieBrowser,
        remoteEjsEnabled: settingsDraft.compatibility.remoteEjsEnabled,
        poTokenProvidersEnabled:
          settingsDraft.compatibility.poTokenProvidersEnabled,
      },
      recentJobs: jobs.slice(0, 10).map((job) => ({
        kind: job.kind,
        status: job.status,
        errorCode: job.error?.code ?? null,
      })),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
      setSettingsMessage("Tanılama bilgisi kopyalandı. Bağlantılar ve dosya yolları dahil edilmedi.");
    } catch {
      setError("Tanılama bilgisi panoya kopyalanamadı.");
    }
  }

  async function repairNativeBridge() {
    setBridgeRepairing(true);
    setSettingsMessage(null);
    setError(null);
    try {
      const result = await invoke<NativeBridgeRepairResult>("repair_native_bridge");
      setSettingsMessage(
        `Tarayıcı bağlantısı ${result.browsersRegistered} tarayıcı için yenilendi. Tarayıcıyı tamamen kapatıp yeniden açın.`,
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBridgeRepairing(false);
    }
  }

  function openSettings() {
    setSettingsDraft(settings);
    setSettingsMessage(null);
    setError(null);
    setSettingsOpen(true);
  }

  async function saveAppSettings(completeOnboarding = false) {
    setSettingsSaving(true);
    setSettingsMessage(null);
    setError(null);
    try {
      const nextSettings = completeOnboarding
        ? { ...settingsDraft, onboardingCompleted: true }
        : settingsDraft;
      await invoke("save_settings", { settings: nextSettings });
      setSettings(nextSettings);
      setSettingsDraft(nextSettings);
      setClipMode(nextSettings.quickProfile.clipMode);
      setSettingsMessage("Ayarlar kaydedildi.");
      setOnboardingOpen(false);
      setSettingsOpen(false);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSettingsSaving(false);
    }
  }

  async function updateYtDlp() {
    if (
      !window.confirm(
        "yt-dlp güncellemesi internetten yeni motor dosyası indirebilir. Güncelleme başlatılsın mı?",
      )
    )
      return;
    setEngineUpdating(true);
    setSettingsMessage(null);
    try {
      const result = await invoke<EngineUpdateResult>("update_ytdlp_engine");
      const refreshed = await invoke<EngineVersions>("engine_versions");
      setEngines(refreshed);
      setSettingsMessage(
        result.updated
          ? `yt-dlp ${result.currentVersion} sürümüne güncellendi.`
          : `yt-dlp zaten güncel (${result.currentVersion}).`,
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setEngineUpdating(false);
    }
  }

  async function showPreview(entry: HistoryEntry) {
    if (!entry.fileExists) {
      setError("Önizleme dosyası artık bu konumda bulunmuyor.");
      return;
    }
    setPreviewLoading(true);
    setError(null);
    try {
      const path = await invoke<string>("prepare_preview", { historyId: entry.id });
      setPreview({ entry, source: convertFileSrc(path) });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function clearDownloadHistory() {
    if (!window.confirm("İndirme geçmişi temizlensin mi? Medya dosyaları silinmez.")) return;
    try {
      await invoke("clear_history");
      setHistory([]);
      setPreview(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function cancel(id: string) {
    try {
      await invoke("cancel_download", { jobId: id });
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === "l") {
        event.preventDefault();
        urlInputRef.current?.focus();
        urlInputRef.current?.select();
        return;
      }
      if (command && event.key === "Enter") {
        event.preventDefault();
        urlFormRef.current?.requestSubmit();
        return;
      }
      if (command && event.key === "1") {
        event.preventDefault();
        if (media && !saving) void download();
        return;
      }
      if (command && event.key === "2") {
        event.preventDefault();
        if (media && !saving) void createClip();
        return;
      }
      if (command && event.shiftKey && event.key.toLowerCase() === "d" && media && !saving) {
        event.preventDefault();
        void download();
        return;
      }
      if (event.key === "Escape") {
        setPreview(null);
        setShortcutsOpen(false);
        setSettingsOpen(false);
        setEnginePanelOpen(false);
        setWorkspacePanelOpen(false);
        setError(null);
        return;
      }
      const target = event.target as HTMLElement | null;
      const typing = target?.matches("input, textarea, select, [contenteditable=true]");
      if (!typing && event.key === "?") {
        event.preventDefault();
        setShortcutsOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [media, saving]);

  const knownDuration = media?.durationMs ?? null;
  const timelineMax =
    knownDuration ??
    Math.max(
      endMs,
      startMs + settings.quickProfile.clipDurationMs,
      settings.quickProfile.clipDurationMs,
    );
  const clipLength = Math.max(0, endMs - startMs);
  const selectionLeft = timelineMax ? (startMs / timelineMax) * 100 : 0;
  const selectionWidth = timelineMax ? (clipLength / timelineMax) * 100 : 0;
  const activeJobs = jobs.filter((job) => active(job.status));
  const outputLocation =
    settings.quickProfile.destinationMode === "folder"
      ? settings.quickProfile.downloadDirectory || "Klasör seçilmedi"
      : "Her kayıtta sor";

  function updateStart(next: number) {
    setStartMs(Math.max(0, Math.min(Math.round(next), endMs - 100)));
  }

  function updateEnd(next: number) {
    const bounded = Math.max(Math.round(next), startMs + 100);
    setEndMs(knownDuration == null ? bounded : Math.min(knownDuration, bounded));
  }

  function applyClipPreset(milliseconds: number) {
    const nextEnd = startMs + milliseconds;
    setEndMs(knownDuration == null ? nextEnd : Math.min(knownDuration, nextEnd));
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">
            <Clapperboard size={20} />
          </span>
          <span className="brand-word">Lipit</span>
          <em>STUDIO</em>
          <small className="brand-version">{LIPIT_DISPLAY_VERSION}</small>
        </div>
        <div className="topbar-right">
          <div className="engine-popover-wrap">
            <button
              className={`topbar-action ${enginePanelOpen ? "selected" : ""}`}
              type="button"
              onClick={() => setEnginePanelOpen((current) => !current)}
              title="Medya motorları"
              aria-expanded={enginePanelOpen}
            >
              <Cpu size={15} /> Motorlar
            </button>
            {enginePanelOpen && (
              <section className="engine-popover" aria-label="Medya motorları">
                <div className="engine-popover-head">
                  <span className="side-icon"><Cpu size={17} /></span>
                  <div>
                    <strong>Medya motorları</strong>
                    <span>Yerel araçların durumu</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEnginePanelOpen(false)}
                    aria-label="Motor panelini kapat"
                  >
                    <X size={15} />
                  </button>
                </div>
                <div className="engine-list">
                  {(["ytDlp", "ffmpeg", "ffprobe", "deno"] as const).map((name) => (
                    <div key={name}>
                      <span>
                        {name === "ytDlp"
                          ? "yt-dlp"
                          : name === "ffmpeg"
                            ? "FFmpeg"
                            : name === "ffprobe"
                              ? "FFprobe"
                              : "Deno"}
                        {engines?.[name] && (
                          <small title={engines[name] || ""}>
                            {engines[name]?.split(/\s+/).slice(0, 2).join(" ")}
                          </small>
                        )}
                      </span>
                      <b className={engines?.[name] ? "ok" : "missing"}>
                        {engines?.[name] ? "Hazır" : "Bulunamadı"}
                      </b>
                    </div>
                  ))}
                  <div>
                    <span>
                      yt-dlp-ejs
                      <small>JS challenge çözücü</small>
                    </span>
                    <b className="ok">{engines?.ejs || "Gömülü"}</b>
                  </div>
                </div>
                <button
                  className="engine-update-button"
                  type="button"
                  onClick={updateYtDlp}
                  disabled={engineUpdating || jobs.some((job) => active(job.status))}
                >
                  {engineUpdating ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <RefreshCw size={14} />
                  )}
                  {engineUpdating ? "Güncelleniyor" : "yt-dlp güncelle"}
                </button>
                {settingsMessage && <p className="settings-message">{settingsMessage}</p>}
              </section>
            )}
          </div>
          <button
            className="topbar-action"
            type="button"
            onClick={openSettings}
            title="Ayarlar"
          >
            <Settings2 size={15} /> Ayarlar
          </button>
          <button
            className="topbar-action"
            type="button"
            onClick={() => setShortcutsOpen(true)}
            title="Klavye kısayolları (?)"
          >
            <Keyboard size={15} /> Kısayollar
          </button>
          <span className="local-pill">
            <i /> Yerel çalışıyor
          </span>
          <button
            className="topbar-action workspace-panel-toggle"
            type="button"
            onClick={() => setWorkspacePanelOpen((current) => !current)}
            aria-label="Son dosyalar ve işlemler"
            aria-expanded={workspacePanelOpen}
          >
            <ListVideo size={16} /> Panel
          </button>
        </div>
      </header>
      <main className="workspace-layout">
        <div className="workspace-main">
          <section className="workflow-section link-step">
            <div className="workflow-heading">
              <span className="step-number">1</span>
              <div>
                <h1>Yeni klip</h1>
                <p>Video bağlantısını ekle, gerisini Lipit hazırlasın.</p>
              </div>
            </div>
            <form ref={urlFormRef} className="workspace-url-form" onSubmit={analyze}>
              <div className="workspace-url-input">
                <Link2 size={19} />
                <input
                  ref={urlInputRef}
                  id="media-url"
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="Video bağlantısını buraya yapıştır"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Video bağlantısı"
                />
                {url && (
                  <button type="button" onClick={() => setUrl("")} aria-label="Bağlantıyı temizle">
                    <X size={17} />
                  </button>
                )}
                {!url && (
                  <button type="button" onClick={paste} title="Panodan yapıştır" aria-label="Panodan yapıştır">
                    <Clipboard size={17} />
                  </button>
                )}
              </div>
              {resolving ? (
                <button className="open-video-button secondary" type="button" onClick={() => void cancelResolve()}>
                  <Square size={16} /> Durdur
                </button>
              ) : (
                <button className="open-video-button" type="submit" disabled={!url.trim()}>
                  <Link2 size={18} /> Videoyu getir
                </button>
              )}
            </form>
            <div className="local-processing-note">
              <ShieldCheck size={14} /> Bağlantı ve medya işlemleri bu cihazda yürütülür.
            </div>
            {captured && (
              <div className="browser-capture-note" aria-live="polite">
                <Globe2 size={16} />
                <span>
                  <strong>Tarayıcıdan yakalandı</strong>
                  {captured.candidate.pageTitle || new URL(captured.candidate.pageUrl).hostname}
                </span>
                <b>{captured.candidate.protocol.toUpperCase()}</b>
              </div>
            )}
            {error && (
              <div className="error-banner workspace-error" role="alert">
                <CircleAlert size={18} />
                <span>{error}</span>
                <button type="button" onClick={() => setError(null)} aria-label="Kapat"><X size={15} /></button>
              </div>
            )}
          </section>

          {media ? (
            <>
              <section className="workflow-section video-step">
                <div className="workflow-heading compact">
                  <span className="step-number">2</span>
                  <div>
                    <h2>Video</h2>
                    <p>Klip oluşturmak istediğin videoyu kontrol et.</p>
                  </div>
                </div>
                <div className="workspace-video-card">
                  {media.thumbnail ? (
                    <div className="workspace-thumbnail-wrap">
                      <img className="workspace-thumbnail" src={media.thumbnail} alt="Video kapağı" />
                      <span>{duration(media.durationMs)}</span>
                    </div>
                  ) : (
                    <div className="workspace-thumbnail empty-thumb"><Film size={34} /></div>
                  )}
                  <div className="workspace-video-copy">
                    <h3>{media.title}</h3>
                    <p>{media.uploader || new URL(media.url).hostname}</p>
                    <span><Clock3 size={15} /> {media.isLive ? "Canlı yayın" : duration(media.durationMs)}</span>
                  </div>
                  <div className="workspace-ready">
                    <span><Check size={15} /> Video hazır</span>
                    <p>Klip aralığını seçip dışa aktarabilirsin.</p>
                  </div>
                </div>
              </section>

              <section className="workflow-section range-step">
                <div className="workflow-heading compact">
                  <span className="step-number">3</span>
                  <div>
                    <h2>Klip aralığı</h2>
                    <p>Klibin başlangıç ve bitiş zamanını seç.</p>
                  </div>
                </div>
                <div className="workspace-timeline">
                  <div className="timeline-poster-strip" aria-hidden="true">
                    {media.thumbnail
                      ? Array.from({ length: 12 }, (_, index) => (
                          <img key={index} src={media.thumbnail || ""} alt="" />
                        ))
                      : Array.from({ length: 12 }, (_, index) => <span key={index} />)}
                  </div>
                  <div
                    className="timeline-dim before"
                    style={{ width: `${selectionLeft}%` }}
                  />
                  <div
                    className="timeline-dim after"
                    style={{ left: `${selectionLeft + selectionWidth}%` }}
                  />
                  <div
                    className="timeline-selection-frame"
                    style={{ left: `${selectionLeft}%`, width: `${selectionWidth}%` }}
                  />
                  <input
                    className="range-start"
                    type="range"
                    min={0}
                    max={timelineMax}
                    step={100}
                    value={startMs}
                    onChange={(event) => updateStart(Number(event.target.value))}
                    aria-label="Klip başlangıcı"
                  />
                  <input
                    className="range-end"
                    type="range"
                    min={0}
                    max={timelineMax}
                    step={100}
                    value={endMs}
                    onChange={(event) => updateEnd(Number(event.target.value))}
                    aria-label="Klip bitişi"
                  />
                </div>
                <div className="timeline-scale" aria-hidden="true">
                  {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
                    <span key={ratio}>{duration(Math.round(timelineMax * ratio))}</span>
                  ))}
                </div>
                <div className="range-controls">
                  <label className="time-field">
                    <span>Başlangıç</span>
                    <TimecodeInput value={startMs} onCommit={updateStart} label="Başlangıç zamanı" />
                    <small>SAAT : DAKİKA : SANİYE : MS</small>
                  </label>
                  <label className="time-field">
                    <span>Bitiş</span>
                    <TimecodeInput value={endMs} onCommit={updateEnd} label="Bitiş zamanı" />
                    <small>SAAT : DAKİKA : SANİYE : MS</small>
                  </label>
                  <div className="selected-duration">
                    <span>Seçilen süre</span>
                    <strong>{timecode(clipLength)}</strong>
                    <small>{clipPresetLabel(clipLength)}</small>
                  </div>
                  <div className="workspace-presets" aria-label="Klip süresi kısayolları">
                    {clipPresets.map((milliseconds) => (
                      <button
                        type="button"
                        key={milliseconds}
                        className={clipLength === milliseconds ? "selected" : ""}
                        onClick={() => applyClipPreset(milliseconds)}
                      >
                        {clipPresetLabel(milliseconds)}
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              <section className="workflow-section export-step">
                <div className="workflow-heading compact">
                  <span className="step-number">4</span>
                  <div>
                    <h2>Dışa aktarma</h2>
                    <p>Dosya ayarlarını kontrol et ve kaydet.</p>
                  </div>
                </div>
                <div className="export-row">
                  <div className="export-options">
                    <div className="export-field format-field">
                      <FileVideo size={18} />
                      <span><small>Biçim</small><strong>MP4</strong></span>
                    </div>
                    <label className="export-field">
                      <Film size={18} />
                      <span>
                        <small>Çözünürlük</small>
                        <select
                          value={height == null ? "best" : String(height)}
                          onChange={(event) => setHeight(event.target.value === "best" ? null : Number(event.target.value))}
                        >
                          {media.profiles.map((profile) => (
                            <option key={profile.height ?? "best"} value={profile.height ?? "best"}>{profile.label}</option>
                          ))}
                        </select>
                      </span>
                    </label>
                    <label className="export-field">
                      <Zap size={18} />
                      <span>
                        <small>Kesim yöntemi</small>
                        <select value={clipMode} onChange={(event) => setClipMode(event.target.value as ClipMode)}>
                          <option value="fast">Hızlı kesim</option>
                          <option value="precise">Hassas kesim</option>
                        </select>
                      </span>
                    </label>
                    <div className="export-field destination">
                      <FolderOpen size={18} />
                      <span><small>Kaydetme konumu</small><strong title={outputLocation}>{outputLocation}</strong></span>
                      <button type="button" onClick={openSettings}>Değiştir</button>
                    </div>
                  </div>
                  <div className="export-actions">
                    <button
                      className="download-video-button"
                      type="button"
                      onClick={download}
                      disabled={saving || media.isLive}
                      title={media.isLive ? "Canlı yayınlarda süreli klip kullanın" : "Videonun tamamını indir"}
                    >
                      <ArrowDownToLine size={18} /> Tamamını indir
                    </button>
                    <button className="create-clip-button" type="button" onClick={createClip} disabled={saving}>
                      {saving ? <LoaderCircle className="spin" size={18} /> : <Scissors size={19} />}
                      Klip oluştur
                    </button>
                  </div>
                </div>
              </section>
            </>
          ) : (
            <section className="workflow-section empty-workspace-step">
              <div className="workflow-heading compact muted">
                <span className="step-number">2</span>
                <div><h2>Video</h2><p>Bağlantı hazır olduğunda video ve klip araçları burada açılır.</p></div>
              </div>
              <div className="workspace-empty-state">
                {resolving ? <LoaderCircle className="spin" size={28} /> : <Film size={30} />}
                <strong>{resolving ? "Video hazırlanıyor" : "Bir video bağlantısı ekle"}</strong>
                <span>{resolving ? "Kaynak ve kalite seçenekleri kontrol ediliyor." : "YouTube ve desteklenen diğer sitelerdeki DRM’siz videoları kullanabilirsin."}</span>
              </div>
            </section>
          )}
        </div>

        {workspacePanelOpen && (
          <button
            className="workspace-panel-backdrop"
            type="button"
            onClick={() => setWorkspacePanelOpen(false)}
            aria-label="Yan paneli kapat"
          />
        )}
        <aside className={`workspace-sidebar ${workspacePanelOpen ? "open" : ""}`}>
          <div className="workspace-sidebar-mobile-head">
            <strong>Etkinlik</strong>
            <button type="button" onClick={() => setWorkspacePanelOpen(false)} aria-label="Paneli kapat"><X size={18} /></button>
          </div>
          <section className="workspace-side-card recent-card">
            <div className="workspace-side-head">
              <span><HistoryIcon size={19} /></span>
              <div><h2>Son dosyalar</h2><p>{history.length ? `${history.length} tamamlanan dosya` : "Henüz kayıt yok"}</p></div>
              {history.length > 0 && (
                <button type="button" onClick={() => void clearDownloadHistory()} title="Geçmişi temizle" aria-label="Geçmişi temizle"><Trash2 size={15} /></button>
              )}
            </div>
            {history.length > 0 ? (
              <div className="workspace-history-list">
                {history.slice(0, 6).map((entry) => (
                  <button
                    type="button"
                    key={entry.id}
                    className="workspace-history-item"
                    onClick={() => void showPreview(entry)}
                    disabled={!entry.fileExists || previewLoading}
                  >
                    <span className="workspace-history-thumb">
                      {previewLoading ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />}
                      {entry.kind === "clip" && entry.startMs != null && entry.endMs != null && <b>{duration(entry.endMs - entry.startMs)}</b>}
                    </span>
                    <span>
                      <strong>{entry.title}</strong>
                      <small>{entry.kind === "clip" ? "Klip" : "Video"} · {fileSize(entry.sizeBytes)} · {historyDate(entry.completedAtMs)}</small>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="workspace-side-empty"><HistoryIcon size={21} /><span>Tamamlanan dosyaların burada görünür.</span></div>
            )}
          </section>

          <section className={`workspace-side-card operations-card ${jobs.length ? "has-items" : ""}`}>
            <div className="workspace-side-head">
              <span><ArrowDownToLine size={19} /></span>
              <div><h2>İşlemler</h2><p>{activeJobs.length ? `${activeJobs.length} işlem sürüyor` : "Aktif işlem yok"}</p></div>
            </div>
            {jobs.length ? (
              <div className="workspace-job-list">
                {jobs.slice(0, 6).map((job) => (
                  <div className="workspace-job-item" key={job.id}>
                    <div className="workspace-job-copy">
                      <strong title={job.outputPath}>{job.outputPath.split(/[\\/]/).pop()}</strong>
                      <span>{job.kind === "clip" ? "Klip" : "Video"} · {statusLabels[job.status]}</span>
                    </div>
                    {active(job.status) && (
                      <button type="button" onClick={() => cancel(job.id)} title="İptal et" aria-label="İşlemi iptal et"><X size={15} /></button>
                    )}
                    <div className="workspace-job-progress"><span style={{ width: `${job.progressPercent ?? 0}%` }} /></div>
                    <b>{job.progressPercent != null ? `${job.progressPercent.toFixed(0)}%` : job.status === "completed" ? "Tamam" : ""}</b>
                    {job.error && <p>{job.error.message}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="workspace-side-empty compact"><ArrowDownToLine size={21} /><span>İndirme ve klip işlemleri burada görünür.</span></div>
            )}
          </section>

          {detected.length > 1 && (
            <section className="workspace-side-card detected-card">
              <div className="workspace-side-head">
                <span><Globe2 size={19} /></span>
                <div><h2>Tarayıcıdan yakalananlar</h2><p>{detected.length} medya bulundu</p></div>
              </div>
              <div className="workspace-detected-list">
                {detected.slice(0, 5).map((item) => (
                  <button
                    type="button"
                    key={`${item.candidate.id}-${item.receivedAtMs}`}
                    className={captured?.candidate.id === item.candidate.id ? "selected" : ""}
                    onClick={() => void openDetectedCandidate(item)}
                  >
                    <strong>{item.candidate.pageTitle || new URL(item.candidate.pageUrl).hostname}</strong>
                    <small>{item.candidate.protocol.toUpperCase()}</small>
                  </button>
                ))}
              </div>
            </section>
          )}
        </aside>
      </main>      {onboardingOpen && (
        <div className="modal-backdrop settings-backdrop" role="presentation">
          <section
            className="settings-modal onboarding-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="onboarding-title"
          >
            <div className="settings-modal-hero">
              <span className="onboarding-mark"><Zap size={22} /></span>
              <div>
                <span className="settings-kicker">LIPIT {LIPIT_DISPLAY_VERSION}</span>
                <h2 id="onboarding-title">Hızlı profilini hazırlayalım</h2>
                <p>
                  Video üzerindeki ⚡ düğmeleri bu tercihleri kullanır. Hepsini
                  daha sonra Ayarlar bölümünden değiştirebilirsin.
                </p>
              </div>
            </div>
            <div className="settings-modal-body">
              <ProfileSettings
                value={settingsDraft}
                onChange={setSettingsDraft}
                onChooseDirectory={() => void chooseDownloadDirectory()}
                showAdvanced={false}
              />
              {error && <p className="settings-inline-error">{error}</p>}
            </div>
            <div className="settings-modal-footer">
              <span>Bu profil yalnızca bilgisayarında saklanır.</span>
              <button
                className="primary-button"
                type="button"
                onClick={() => void saveAppSettings(true)}
                disabled={settingsSaving}
              >
                {settingsSaving ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}
                {settingsSaving ? "Kaydediliyor" : "Profili kaydet ve başla"}
              </button>
            </div>
          </section>
        </div>
      )}
      {settingsOpen && !onboardingOpen && (
        <div
          className="modal-backdrop settings-backdrop"
          role="presentation"
          onMouseDown={() => setSettingsOpen(false)}
        >
          <section
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head settings-modal-head">
              <span className="side-icon"><Settings2 size={18} /></span>
              <div>
                <h2 id="settings-title">Ayarlar</h2>
                <p>Hızlı profil, kalite ve uyumluluk tercihleri</p>
              </div>
              <button type="button" onClick={() => setSettingsOpen(false)} aria-label="Ayarları kapat">
                <X size={18} />
              </button>
            </div>
            <div className="settings-modal-body">
              <ProfileSettings
                value={settingsDraft}
                onChange={setSettingsDraft}
                onChooseDirectory={() => void chooseDownloadDirectory()}
                showAdvanced
                pluginDirectory={engines?.poTokenPluginsDir}
                onRepairNativeBridge={() => void repairNativeBridge()}
                bridgeRepairing={bridgeRepairing}
              />
              {settingsMessage && <p className="settings-message">{settingsMessage}</p>}
              {error && <p className="settings-inline-error">{error}</p>}
            </div>
            <div className="settings-modal-footer">
              <button
                className="settings-cancel-button"
                type="button"
                onClick={() => void copyDiagnostics()}
              >
                <Clipboard size={16} /> Tanılamayı kopyala
              </button>
              <button
                className="settings-cancel-button"
                type="button"
                onClick={() => setSettingsOpen(false)}
              >
                Vazgeç
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void saveAppSettings(false)}
                disabled={settingsSaving}
              >
                {settingsSaving ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}
                {settingsSaving ? "Kaydediliyor" : "Ayarları kaydet"}
              </button>
            </div>
          </section>
        </div>
      )}
      {preview && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPreview(null)}>
          <section
            className="preview-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Masaüstü video önizlemesi"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <span className="side-icon history-icon"><ListVideo size={18} /></span>
              <div>
                <h2>{preview.entry.title}</h2>
                <p>{preview.entry.sourceHost} · {fileSize(preview.entry.sizeBytes)}</p>
              </div>
              <button type="button" onClick={() => setPreview(null)} aria-label="Önizlemeyi kapat">
                <X size={18} />
              </button>
            </div>
            <video src={preview.source} controls autoPlay preload="metadata" />
            <div className="preview-meta">
              <span>Yerel MP4 önizlemesi</span>
              <code title={preview.entry.outputPath}>{preview.entry.outputPath}</code>
            </div>
          </section>
        </div>
      )}
      {shortcutsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShortcutsOpen(false)}>
          <section
            className="shortcut-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Klavye kısayolları"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <span className="side-icon"><Keyboard size={18} /></span>
              <div><h2>Klavye kısayolları</h2><p>Fare kullanmadan hızlı kontrol</p></div>
              <button type="button" onClick={() => setShortcutsOpen(false)} aria-label="Kapat"><X size={18} /></button>
            </div>
            <div className="shortcut-list">
              <div><span>Bağlantı alanına git</span><kbd>Ctrl</kbd><kbd>L</kbd></div>
              <div><span>Bağlantıyı çözümle</span><kbd>Ctrl</kbd><kbd>Enter</kbd></div>
              <div><span>Tamamını indir</span><kbd>Ctrl</kbd><kbd>1</kbd></div>
              <div><span>Klip oluştur</span><kbd>Ctrl</kbd><kbd>2</kbd></div>
              <div><span>İndirmeyi başlat</span><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>D</kbd></div>
              <div><span>Bu pencereyi aç</span><kbd>?</kbd></div>
              <div><span>Pencereleri kapat</span><kbd>Esc</kbd></div>
            </div>
          </section>
        </div>
      )}
      <footer className="footer">
        <span>Lipit Studio · {LIPIT_DISPLAY_VERSION.toLowerCase()}</span>
        <span>FFmpeg yerel · Akış çözümleyici hazır · Kayıt kasası etkin</span>
      </footer>
    </div>
  );
}

function App() {
  let windowLabel = "main";
  try {
    windowLabel = getCurrentWindow().label;
  } catch {
    // Browser previews do not expose the Tauri window API.
  }
  const widgetJobId = windowLabel.startsWith("quick-widget-")
    ? windowLabel.slice("quick-widget-".length)
    : new URLSearchParams(window.location.search).get("widget");
  return widgetJobId ? <QuickWidget jobId={widgetJobId} /> : <MainApp />;
}

export default App;
