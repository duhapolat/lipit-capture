import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  ArrowDownToLine,
  Check,
  CircleAlert,
  Clapperboard,
  Clipboard,
  Clock3,
  Cpu,
  Download,
  Film,
  FileVideo,
  FolderOpen,
  Globe2,
  Info,
  Keyboard,
  Link2,
  ListVideo,
  LoaderCircle,
  Scissors,
  Settings2,
  ShieldCheck,
  Square,
  X,
  Zap,
} from "lucide-react";
import type {
  AppSettings,
  ClipMode,
  DownloadJob,
  EngineUpdateResult,
  EngineVersions,
  HistoryEntry,
  JobPlan,
  NativeBridgeRepairResult,
  ResolvedMedia,
  StoredCandidate,
} from "./types";
import {
  displayVersion,
  errorMessage,
  formatDuration,
  initialClipRange,
  isActive,
} from "./lib/format";
import { invokeWithTimeout, RUNNING_IN_TAURI } from "./lib/api";
import { checkForUpdates, updateCheckDue, type UpdateInfo } from "./lib/updates";
import { Dialog } from "./components/Dialog";
import { ConfirmDialog, type ConfirmRequest } from "./components/ConfirmDialog";
import { ProfileSettings } from "./components/ProfileSettings";
import { ClipRangeEditor } from "./components/ClipRangeEditor";
import { ExtensionSetup, extensionMismatch, useExtensionStatus } from "./components/ExtensionSetup";
import { HistoryDialog, HistoryPanel } from "./components/HistoryViews";
import { JobsPanel } from "./components/JobsPanel";
import { AboutDialog } from "./components/AboutDialog";
import { StatsPanel } from "./components/StatsPanel";
import { EnginePopover } from "./components/EnginePopover";

const LIPIT_VERSION = __LIPIT_VERSION__;
const LIPIT_DISPLAY_VERSION = displayVersion(LIPIT_VERSION);
const SLOW_RESOLVE_HINT_MS = 10_000;

const defaultSettings: AppSettings = {
  schemaVersion: 2,
  onboardingCompleted: false,
  termsAccepted: false,
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
    cookieFile: null,
    remoteEjsEnabled: false,
    poTokenProvidersEnabled: false,
  },
  filenameTemplate: "title_date",
  updateChecksEnabled: true,
};

const DESIGN_PREVIEW =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has("design-preview");
const DESIGN_PREVIEW_THUMBNAIL = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
    <defs><linearGradient id="g" x1="0" x2="1"><stop stop-color="#17222d"/><stop offset="1" stop-color="#3b2018"/></linearGradient></defs>
    <rect width="640" height="360" fill="url(#g)"/><rect x="28" y="28" width="584" height="304" rx="16" fill="#111820" stroke="#ff7a45" stroke-opacity=".38"/>
    <circle cx="320" cy="170" r="48" fill="#ff7a45" fill-opacity=".92"/><path d="M305 142 350 170 305 198Z" fill="#16100d"/>
    <text x="320" y="270" fill="#f4f6f8" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="30" font-weight="700">Lipit Capture</text>
  </svg>
`)}`;
const DESIGN_PREVIEW_MEDIA: ResolvedMedia = {
  url: "https://media.example.org/watch?v=preview",
  title: "Örnek video başlığı",
  uploader: "Örnek kanal",
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
  preview: null,
};

const hostOf = (value: string) => {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
};

export function MainApp() {
  const urlInputRef = useRef<HTMLInputElement>(null);
  const urlFormRef = useRef<HTMLFormElement>(null);
  const [url, setUrl] = useState(DESIGN_PREVIEW ? DESIGN_PREVIEW_MEDIA.url : "");
  const [media, setMedia] = useState<ResolvedMedia | null>(DESIGN_PREVIEW ? DESIGN_PREVIEW_MEDIA : null);
  const [height, setHeight] = useState<number | null>(DESIGN_PREVIEW ? 1080 : null);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [engines, setEngines] = useState<EngineVersions | null>(null);
  const [resolving, setResolving] = useState(false);
  const [slowResolve, setSlowResolve] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
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
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [engineUpdating, setEngineUpdating] = useState(false);
  const [bridgeRepairing, setBridgeRepairing] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [engineMessage, setEngineMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [preview, setPreview] = useState<{ title: string; subtitle: string; path: string; source: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [workspacePanelOpen, setWorkspacePanelOpen] = useState(false);
  const [enginePanelOpen, setEnginePanelOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [updates, setUpdates] = useState<UpdateInfo | null>(null);
  const [statsKey, setStatsKey] = useState(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  /** Jobs started from this window, kept so a failed job can be retried. */
  const plansRef = useRef(new Map<string, JobPlan & { outputPath: string }>());
  const { status: extensionStatus } = useExtensionStatus(15_000);

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await invoke<HistoryEntry[]>("list_history"));
    } catch {
      // History is secondary to the active download flow.
    }
  }, []);

  const setResolvedMedia = useCallback(
    (result: ResolvedMedia, requestedStart = 0, clipDurationMs = 30_000) => {
      setMedia(result);
      setHeight(result.profiles[0]?.height ?? null);
      const range = initialClipRange(result.durationMs, requestedStart, clipDurationMs);
      setStartMs(range.startMs);
      setEndMs(range.endMs);
    },
    [],
  );

  const enqueue = useCallback(
    async (plan: JobPlan, activeSettings: AppSettings, retryOutputPath?: string) => {
      setError(null);
      setSaving(true);
      try {
        const folderMode = activeSettings.quickProfile.destinationMode === "folder";
        let outputPath: string | null = retryOutputPath ?? null;
        let autoRename = Boolean(retryOutputPath);
        if (!outputPath) {
          const filename = await invoke<string>("suggest_filename", {
            title: plan.media.title,
            sourceHost: hostOf(plan.media.refreshUrl || plan.media.url),
            kind: plan.kind,
            template: activeSettings.filenameTemplate,
          });
          if (folderMode) {
            outputPath = await invoke<string>("quick_output_path", { suggestedFilename: filename });
            autoRename = true;
          } else {
            outputPath = await save({
              title: plan.kind === "clip" ? "Klibi MP4 olarak kaydet" : "MP4 dosyasını kaydet",
              defaultPath: filename,
              filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
            });
          }
        }
        if (!outputPath) return null;
        const request = {
          url: plan.media.url,
          qualityHeight: plan.qualityHeight,
          outputPath,
          direct: plan.media.direct,
          refreshUrl: plan.media.refreshUrl,
          knownDurationMs: plan.media.durationMs,
          requestContext: plan.media.requestContext,
          autoRename,
          ...(plan.kind === "clip" && plan.range
            ? { startMs: plan.range.startMs, endMs: plan.range.endMs, mode: plan.clipMode }
            : {}),
        };
        const job = await invoke<DownloadJob>(plan.kind === "clip" ? "start_clip" : "start_download", {
          request,
        });
        plansRef.current.set(job.id, { ...plan, outputPath: job.outputPath });
        setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
        return job;
      } catch (cause) {
        setError(errorMessage(cause));
        return null;
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  /** "Open in Lipit" from the browser, or a quick action that needs setup first. */
  const openDetectedCandidate = useCallback(
    async (stored: StoredCandidate) => {
      const isClip = stored.action === "clip" || stored.action === "quick_clip";
      const isQuick = stored.action === "quick_download" || stored.action === "quick_clip";
      setCaptured(stored);
      setUrl(stored.candidate.mediaUrl || stored.candidate.pageUrl);
      setError(null);
      setMedia(null);
      setResolving(true);
      try {
        const activeSettings = await invoke<AppSettings>("get_settings").catch(() => settingsRef.current);
        setSettings(activeSettings);
        if (isQuick && !(activeSettings.onboardingCompleted && activeSettings.termsAccepted)) {
          setSettingsDraft(activeSettings);
          setOnboardingOpen(true);
          setDialogError("Hızlı işlemleri kullanmadan önce kullanım koşullarını onayla ve profili kaydet.");
        }
        const result = await invokeWithTimeout<ResolvedMedia>("resolve_detected_candidate", {
          candidate: stored.candidate,
        });
        setResolvedMedia(
          result,
          isClip ? stored.candidate.currentTimeMs ?? 0 : 0,
          activeSettings.quickProfile.clipDurationMs,
        );
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setResolving(false);
      }
    },
    [setResolvedMedia],
  );

  const openDetectedCandidateRef = useRef(openDetectedCandidate);
  openDetectedCandidateRef.current = openDetectedCandidate;

  // Initial load, job events and browser hand-offs.
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
        if (!alive) return;
        setSettings(result);
        setSettingsDraft(result);
        setClipMode(result.quickProfile.clipMode);
        setOnboardingOpen(!result.onboardingCompleted || !result.termsAccepted);
      })
      .catch(() => {
        if (alive) setOnboardingOpen(RUNNING_IN_TAURI);
      })
      .finally(() => {
        invoke<string[]>("take_notices")
          .then((items) => {
            if (alive && items.length) setNotices((current) => [...current, ...items]);
          })
          .catch(() => {});
      });
    invoke<DownloadJob[]>("list_jobs")
      .then((result) => {
        if (alive) setJobs(result);
      })
      .catch(() => {});
    void refreshHistory();
    const jobSubscription = listen<DownloadJob>("job-update", ({ payload }) => {
      if (!alive) return;
      setJobs((current) => {
        const index = current.findIndex((job) => job.id === payload.id);
        if (index < 0) return [payload, ...current];
        const next = [...current];
        next[index] = payload;
        return next;
      });
      if (payload.status === "completed") void refreshHistory();
      if (!isActive(payload.status)) setStatsKey((value) => value + 1);
    }).catch(() => () => {});
    const receiveCandidates = async () => {
      try {
        const incoming = await invoke<StoredCandidate[]>("take_pending_candidates");
        if (!alive || !incoming.length) return;
        const fresh = [...incoming].reverse();
        setDetected((current) =>
          [...fresh, ...current]
            .filter(
              (item, index, all) =>
                all.findIndex((other) => other.candidate.id === item.candidate.id) === index,
            )
            .slice(0, 8),
        );
        const newest = fresh[0];
        if (newest) void openDetectedCandidateRef.current(newest);
      } catch {
        // The bridge can be empty before the extension is installed.
      }
    };
    void receiveCandidates();
    const candidateSubscription = listen("candidates-available", () => {
      void receiveCandidates();
    }).catch(() => () => {});
    return () => {
      alive = false;
      jobSubscription.then((unlisten) => unlisten());
      candidateSubscription.then((unlisten) => unlisten());
    };
  }, [refreshHistory]);

  // Daily, opt-out release check (version numbers only).
  useEffect(() => {
    if (!RUNNING_IN_TAURI || !settings.updateChecksEnabled || !engines || !updateCheckDue()) return;
    let alive = true;
    checkForUpdates(LIPIT_VERSION, engines.ytDlp)
      .then((result) => {
        if (alive) setUpdates(result);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [engines, settings.updateChecksEnabled]);

  useEffect(() => {
    if (!resolving) {
      setSlowResolve(false);
      return;
    }
    const timer = window.setTimeout(() => setSlowResolve(true), SLOW_RESOLVE_HINT_MS);
    return () => window.clearTimeout(timer);
  }, [resolving]);

  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMedia(null);
    setCaptured(null);
    setResolving(true);
    try {
      const result = await invokeWithTimeout<ResolvedMedia>("resolve_media", { url: url.trim() });
      setResolvedMedia(result, 0, settings.quickProfile.clipDurationMs);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setResolving(false);
    }
  }

  async function cancelResolve() {
    await invoke("cancel_resolution").catch(() => {});
    setResolving(false);
    setError("Çözümleme durduruldu. Başka bir bağlantı deneyebilirsin.");
  }

  async function paste() {
    try {
      setUrl(await navigator.clipboard.readText());
    } catch {
      setError("Panoya erişilemedi. Bağlantıyı alana yapıştırabilirsin.");
    }
  }

  async function download() {
    if (!media) return;
    if (media.isLive) {
      setError("Canlı yayınlarda tamamını indirmek yerine süreli bir klip oluştur.");
      return;
    }
    await enqueue({ kind: "download", media, qualityHeight: height, range: null, clipMode }, settings);
  }

  async function createClip() {
    if (!media) return;
    if (endMs <= startMs) {
      setError("Klip bitiş zamanı başlangıçtan sonra olmalıdır.");
      return;
    }
    await enqueue(
      { kind: "clip", media, qualityHeight: height, range: { startMs, endMs }, clipMode },
      settings,
    );
  }

  async function retry(job: DownloadJob) {
    const plan = plansRef.current.get(job.id);
    if (!plan) return;
    await enqueue(plan, settings, plan.outputPath);
  }

  async function chooseDownloadDirectory() {
    try {
      const selected = await open({ title: "Hızlı indirme klasörünü seç", directory: true, multiple: false });
      if (typeof selected === "string") {
        setSettingsDraft((current) => ({
          ...current,
          quickProfile: { ...current.quickProfile, destinationMode: "folder", downloadDirectory: selected },
        }));
      }
    } catch (cause) {
      setDialogError(errorMessage(cause));
    }
  }

  async function chooseCookieFile() {
    try {
      const selected = await open({
        title: "cookies.txt dosyasını seç",
        multiple: false,
        filters: [{ name: "Çerez dosyası", extensions: ["txt"] }],
      });
      if (typeof selected === "string") {
        setSettingsDraft((current) => ({
          ...current,
          compatibility: { ...current.compatibility, cookieBrowser: "file", cookieFile: selected },
        }));
      }
    } catch (cause) {
      setDialogError(errorMessage(cause));
    }
  }

  async function copyDiagnostics() {
    const diagnostics = {
      lipitVersion: LIPIT_VERSION,
      platform: navigator.platform,
      extensionVersion: extensionStatus?.extensionVersion ?? null,
      bridgeRegistered: extensionStatus?.hostRegistered ?? null,
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
        poTokenProvidersEnabled: settingsDraft.compatibility.poTokenProvidersEnabled,
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
      setDialogError("Tanılama bilgisi panoya kopyalanamadı.");
    }
  }

  async function repairNativeBridge() {
    setBridgeRepairing(true);
    setSettingsMessage(null);
    setDialogError(null);
    try {
      const result = await invoke<NativeBridgeRepairResult>("repair_native_bridge");
      setSettingsMessage(
        `Tarayıcı bağlantısı ${result.browsersRegistered} tarayıcı için yenilendi. Tarayıcıyı tamamen kapatıp yeniden aç.`,
      );
    } catch (cause) {
      setDialogError(errorMessage(cause));
    } finally {
      setBridgeRepairing(false);
    }
  }

  function openSettings() {
    setSettingsDraft(settings);
    setSettingsMessage(null);
    setDialogError(null);
    setSettingsOpen(true);
  }

  async function saveAppSettings(completeOnboarding = false) {
    if (completeOnboarding && !settingsDraft.termsAccepted) {
      setDialogError("Devam etmek için kullanım koşullarını onaylaman gerekiyor.");
      return;
    }
    setSettingsSaving(true);
    setSettingsMessage(null);
    setDialogError(null);
    try {
      const nextSettings = completeOnboarding ? { ...settingsDraft, onboardingCompleted: true } : settingsDraft;
      await invoke("save_settings", { settings: nextSettings });
      setSettings(nextSettings);
      setSettingsDraft(nextSettings);
      setClipMode(nextSettings.quickProfile.clipMode);
      setOnboardingOpen(false);
      setSettingsOpen(false);
    } catch (cause) {
      setDialogError(errorMessage(cause));
    } finally {
      setSettingsSaving(false);
    }
  }

  async function runEngineUpdate() {
    setEngineUpdating(true);
    setEngineMessage(null);
    try {
      const result = await invoke<EngineUpdateResult>("update_ytdlp_engine");
      setEngines(await invoke<EngineVersions>("engine_versions"));
      setUpdates((current) => (current ? { ...current, engine: null } : current));
      setEngineMessage(
        result.updated
          ? `yt-dlp ${result.currentVersion} sürümüne güncellendi.`
          : `yt-dlp zaten güncel (${result.currentVersion}).`,
      );
    } catch (cause) {
      setEngineMessage(errorMessage(cause));
    } finally {
      setEngineUpdating(false);
    }
  }

  function requestEngineUpdate() {
    setConfirm({
      title: "yt-dlp güncellensin mi?",
      message:
        "Güncelleme, motorun resmi sürüm kaynağından yeni dosyayı indirir ve özetini doğrular. Doğrulanamazsa önceki sürüm geri yüklenir.",
      confirmLabel: "Güncelle",
      onConfirm: runEngineUpdate,
    });
  }

  async function openPreview(id: string, title: string, subtitle: string) {
    setPreviewLoading(true);
    setError(null);
    try {
      const path = await invoke<string>("prepare_preview", { historyId: id });
      setPreview({ title, subtitle, path, source: convertFileSrc(path) });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function reveal(id: string) {
    try {
      await invoke("reveal_output", { id });
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  function requestClearHistory() {
    setConfirm({
      title: "Geçmiş temizlensin mi?",
      message: "Tüm geçmiş kayıtları ve küçük resimler silinir. İndirilen medya dosyaları silinmez.",
      confirmLabel: "Geçmişi temizle",
      destructive: true,
      onConfirm: async () => {
        try {
          await invoke("clear_history");
          setHistory([]);
          setPreview(null);
        } catch (cause) {
          setError(errorMessage(cause));
        }
      },
    });
  }

  function requestDeleteHistoryEntry(entry: HistoryEntry) {
    setConfirm({
      title: "Kayıt geçmişten silinsin mi?",
      message: `“${entry.title}” kaydı geçmişten kaldırılır. Dosyanın kendisi silinmez.`,
      confirmLabel: "Kaydı sil",
      destructive: true,
      onConfirm: async () => {
        try {
          await invoke("delete_history_entry", { historyId: entry.id });
          await refreshHistory();
        } catch (cause) {
          setError(errorMessage(cause));
        }
      },
    });
  }

  async function cancel(job: DownloadJob) {
    try {
      await invoke("cancel_download", { jobId: job.id });
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  const anyDialogOpen =
    onboardingOpen || settingsOpen || Boolean(preview) || shortcutsOpen || historyOpen || aboutOpen || Boolean(confirm);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = event.ctrlKey || event.metaKey;
      if (event.key === "Escape") {
        setEnginePanelOpen(false);
        setWorkspacePanelOpen(false);
        if (!anyDialogOpen) setError(null);
        return;
      }
      if (anyDialogOpen) return;
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
      const target = event.target as HTMLElement | null;
      const typing = target?.matches("input, textarea, select, [contenteditable=true]");
      if (!typing && event.key === "?") {
        event.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const activeJobs = jobs.filter((job) => isActive(job.status));
  const outputLocation =
    settings.quickProfile.destinationMode === "folder"
      ? settings.quickProfile.downloadDirectory || "Klasör seçilmedi"
      : "Her kayıtta sor";
  const missingEngines = engines
    ? (["ytDlp", "ffmpeg", "ffprobe"] as const).filter((name) => !engines[name])
    : [];
  const enginesReady = engines != null && missingEngines.length === 0;
  const engineSummary = engines
    ? enginesReady
      ? [
          engines.ytDlp && `yt-dlp ${engines.ytDlp.split(/\s+/)[0]}`,
          engines.ffmpeg && `FFmpeg ${(engines.ffmpeg.split(/\s+/)[2] ?? "").split("-")[0]}`.trim(),
          engines.deno ? "Deno hazır" : "Deno yok",
        ]
          .filter(Boolean)
          .join(" · ")
      : `Eksik motor: ${missingEngines.map((name) => (name === "ytDlp" ? "yt-dlp" : name === "ffmpeg" ? "FFmpeg" : "FFprobe")).join(", ")}`
    : "Motorlar denetleniyor";
  const showExtensionMismatch = extensionMismatch(extensionStatus, LIPIT_VERSION);
  const historyActions = {
    onPreview: (entry: HistoryEntry) => {
      if (!entry.fileExists) {
        setError("Önizleme dosyası artık bu konumda bulunmuyor.");
        return;
      }
      void openPreview(entry.id, entry.title, `${entry.sourceHost}`);
    },
    onReveal: (entry: HistoryEntry) => void reveal(entry.id),
    onDelete: requestDeleteHistoryEntry,
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon"><Clapperboard size={20} /></span>
          <span className="brand-word">Lipit</span>
          <em>CAPTURE</em>
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
              {updates?.engine && <i className="update-dot" aria-label="Güncelleme var" />}
            </button>
            {enginePanelOpen && (
              <EnginePopover
                engines={engines}
                updating={engineUpdating}
                updateDisabled={activeJobs.length > 0}
                availableEngineUpdate={updates?.engine?.version ?? null}
                message={engineMessage}
                onUpdate={requestEngineUpdate}
                onClose={() => setEnginePanelOpen(false)}
              />
            )}
          </div>
          <button className="topbar-action" type="button" onClick={openSettings} title="Ayarlar">
            <Settings2 size={15} /> Ayarlar
          </button>
          <button className="topbar-action" type="button" onClick={() => setShortcutsOpen(true)} title="Klavye kısayolları (?)">
            <Keyboard size={15} /> Kısayollar
          </button>
          <button className="topbar-action" type="button" onClick={() => setAboutOpen(true)} title="Hakkında ve yasal belgeler">
            <Info size={15} /> Hakkında
          </button>
          <span className={`local-pill ${engines == null ? "pending" : enginesReady ? "" : "error"}`} title={engineSummary}>
            <i /> {engines == null ? "Denetleniyor" : enginesReady ? "Motorlar hazır" : "Motor eksik"}
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

      {(updates?.app || showExtensionMismatch || notices.length > 0) && (
        <div className="app-banners" role="status" aria-live="polite">
          {updates?.app && (
            <div className="app-banner">
              <Download size={15} />
              <span>Lipit {updates.app.version} yayımlandı.</span>
              <button type="button" onClick={() => void invoke("open_project_page", { page: "releases" }).catch(() => {})}>
                Sürüm sayfasını aç
              </button>
              <button type="button" onClick={() => setUpdates((current) => (current ? { ...current, app: null } : current))} aria-label="Bildirimi kapat">
                <X size={14} />
              </button>
            </div>
          )}
          {showExtensionMismatch && (
            <div className="app-banner warning">
              <CircleAlert size={15} />
              <span>
                Tarayıcı uzantısı ({extensionStatus?.extensionVersion}) bu sürümle eşleşmiyor. Uzantılar sayfasında Lipit'i yeniden yükle.
              </span>
              <button type="button" onClick={() => void invoke("open_extension_folder").catch((cause) => setError(errorMessage(cause)))}>
                Uzantı klasörünü aç
              </button>
            </div>
          )}
          {notices.map((notice, index) => (
            <div className="app-banner warning" key={`${notice}-${index}`}>
              <CircleAlert size={15} />
              <span>{notice}</span>
              <button type="button" onClick={() => setNotices((current) => current.filter((_, item) => item !== index))} aria-label="Bildirimi kapat">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <main className="workspace-layout">
        <div className="workspace-main">
          <section className="workflow-section link-step">
            <div className="workflow-heading">
              <span className="step-number">1</span>
              <div>
                <h1>Yeni video</h1>
                <p>Video bağlantısını ekle; tamamını indir veya istediğin aralığı klip olarak kaydet.</p>
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
                {url ? (
                  <button type="button" onClick={() => setUrl("")} aria-label="Bağlantıyı temizle"><X size={17} /></button>
                ) : (
                  <button type="button" onClick={paste} title="Panodan yapıştır" aria-label="Panodan yapıştır"><Clipboard size={17} /></button>
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
              <ShieldCheck size={14} /> Bağlantı ve medya işlemleri bu cihazda yürütülür. Yalnızca indirme hakkın olan içerikleri kaydet.
            </div>
            {captured && (
              <div className="browser-capture-note" aria-live="polite">
                <Globe2 size={16} />
                <span>
                  <strong>Tarayıcıdan yakalandı</strong>
                  {captured.candidate.pageTitle || hostOf(captured.candidate.pageUrl)}
                </span>
                <b>{captured.candidate.protocol.toUpperCase()}</b>
              </div>
            )}
            {error && (
              <div className="error-banner workspace-error" role="alert">
                <CircleAlert size={18} />
                <span>{error}</span>
                <button type="button" onClick={() => setError(null)} aria-label="Hatayı kapat"><X size={15} /></button>
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
                    <p>Doğru videonun geldiğini kontrol et.</p>
                  </div>
                </div>
                <div className="workspace-video-card">
                  {media.thumbnail ? (
                    <div className="workspace-thumbnail-wrap">
                      <img className="workspace-thumbnail" src={media.thumbnail} alt="Video kapağı" />
                      <span>{formatDuration(media.durationMs)}</span>
                    </div>
                  ) : (
                    <div className="workspace-thumbnail empty-thumb"><Film size={34} /></div>
                  )}
                  <div className="workspace-video-copy">
                    <h3>{media.title}</h3>
                    <p>{media.uploader || hostOf(media.url)}</p>
                    <span><Clock3 size={15} /> {media.isLive ? "Canlı yayın" : formatDuration(media.durationMs)}</span>
                  </div>
                  <div className="workspace-ready">
                    <span><Check size={15} /> Video hazır</span>
                    <p>Tamamını indirebilir veya aşağıdan bir aralık seçebilirsin.</p>
                  </div>
                </div>
              </section>

              <section className="workflow-section range-step">
                <div className="workflow-heading compact">
                  <span className="step-number">3</span>
                  <div>
                    <h2>Klip aralığı</h2>
                    <p>Başlangıç ve bitişi seç; seçilen anların karesi önizlenir.</p>
                  </div>
                </div>
                <ClipRangeEditor
                  startMs={startMs}
                  endMs={endMs}
                  durationMs={media.durationMs}
                  defaultClipMs={settings.quickProfile.clipDurationMs}
                  preview={media.preview}
                  onStartChange={setStartMs}
                  onEndChange={setEndMs}
                />
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
                      title={media.isLive ? "Canlı yayınlarda süreli klip kullan" : "Videonun tamamını indir"}
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
              <div className="workspace-empty-state" aria-live="polite">
                {resolving ? <LoaderCircle className="spin" size={28} /> : <Film size={30} />}
                <strong>{resolving ? "Video hazırlanıyor" : "Bir video bağlantısı ekle"}</strong>
                <span>
                  {resolving
                    ? slowResolve
                      ? "Kaynak yavaş yanıt veriyor; bekleniyor. İstersen Durdur ile iptal edebilirsin."
                      : "Kaynak ve kalite seçenekleri kontrol ediliyor."
                    : "Kendi videolarını, açık lisanslı içerikleri ve indirme iznin olan DRM’siz videoları kullanabilirsin."}
                </span>
              </div>
            </section>
          )}
        </div>

        {workspacePanelOpen && (
          <button className="workspace-panel-backdrop" type="button" onClick={() => setWorkspacePanelOpen(false)} aria-label="Yan paneli kapat" />
        )}
        <aside className={`workspace-sidebar ${workspacePanelOpen ? "open" : ""}`}>
          <div className="workspace-sidebar-mobile-head">
            <strong>Etkinlik</strong>
            <button type="button" onClick={() => setWorkspacePanelOpen(false)} aria-label="Paneli kapat"><X size={18} /></button>
          </div>
          <HistoryPanel
            history={history}
            previewLoading={previewLoading}
            actions={historyActions}
            onShowAll={() => setHistoryOpen(true)}
            onClear={requestClearHistory}
          />
          <JobsPanel
            jobs={jobs}
            canRetry={(job) => plansRef.current.has(job.id)}
            onCancel={(job) => void cancel(job)}
            onReveal={(job) => void reveal(job.id)}
            onPlay={(job) =>
              void openPreview(job.id, job.outputPath.split(/[\\/]/).pop() || "Video", hostOf(job.sourceUrl))
            }
            onRetry={(job) => void retry(job)}
          />
          {detected.length > 0 && (
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
                    <strong>{item.candidate.pageTitle || hostOf(item.candidate.pageUrl)}</strong>
                    <small>{item.candidate.protocol.toUpperCase()}</small>
                  </button>
                ))}
              </div>
            </section>
          )}
        </aside>
      </main>

      {onboardingOpen && (
        <Dialog
          className="settings-modal onboarding-modal"
          labelledBy="onboarding-title"
          backdropClassName="settings-backdrop"
          closeOnBackdrop={false}
        >
          <div className="settings-modal-hero">
            <span className="onboarding-mark"><Zap size={22} /></span>
            <div>
              <span className="settings-kicker">LIPIT {LIPIT_DISPLAY_VERSION}</span>
              <h2 id="onboarding-title">Lipit'i hazırlayalım</h2>
              <p>
                Hızlı profil, tarayıcı uzantısı ve kullanım koşulları. Hepsini daha sonra
                Ayarlar bölümünden değiştirebilirsin.
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
            <ExtensionSetup appVersion={LIPIT_VERSION} onError={setDialogError} />
            <section className="settings-group terms-group">
              <div className="settings-group-head">
                <span className="side-icon"><ShieldCheck size={17} /></span>
                <div>
                  <h3>Kullanım koşulları</h3>
                  <p>
                    Lipit kişisel arşiv aracıdır. Yalnızca kendi içeriklerini, açık lisanslı
                    içerikleri veya hak sahibinin indirmene izin verdiği videoları kaydet. DRM
                    korumalı içerik desteklenmez; kaydettiğin içeriğin kullanımından sen sorumlusun.
                  </p>
                </div>
              </div>
              <label className="setting-row">
                <input
                  type="checkbox"
                  checked={settingsDraft.termsAccepted}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({ ...current, termsAccepted: event.target.checked }))
                  }
                />
                <span className="setting-icon"><Check size={14} /></span>
                <span>
                  <strong>Kullanım koşullarını okudum ve kabul ediyorum</strong>
                  <small>
                    Tam metin için:{" "}
                    <button type="button" className="inline-link" onClick={() => setAboutOpen(true)}>
                      Hakkında › Kullanım koşulları
                    </button>
                  </small>
                </span>
              </label>
            </section>
            {dialogError && <p className="settings-inline-error" role="alert">{dialogError}</p>}
          </div>
          <div className="settings-modal-footer">
            <span>Bu profil ve onayın yalnızca bilgisayarında saklanır.</span>
            <button
              className="primary-button"
              type="button"
              onClick={() => void saveAppSettings(true)}
              disabled={settingsSaving || !settingsDraft.termsAccepted}
            >
              {settingsSaving ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}
              {settingsSaving ? "Kaydediliyor" : "Profili kaydet ve başla"}
            </button>
          </div>
        </Dialog>
      )}

      {settingsOpen && !onboardingOpen && (
        <Dialog
          className="settings-modal"
          labelledBy="settings-title"
          backdropClassName="settings-backdrop"
          onClose={() => setSettingsOpen(false)}
        >
          <div className="modal-head settings-modal-head">
            <span className="side-icon"><Settings2 size={18} /></span>
            <div>
              <h2 id="settings-title">Ayarlar</h2>
              <p>Hızlı profil, uzantı, uyumluluk ve yerel istatistikler</p>
            </div>
            <button type="button" onClick={() => setSettingsOpen(false)} aria-label="Ayarları kapat"><X size={18} /></button>
          </div>
          <div className="settings-modal-body">
            <ProfileSettings
              value={settingsDraft}
              onChange={setSettingsDraft}
              onChooseDirectory={() => void chooseDownloadDirectory()}
              onChooseCookieFile={() => void chooseCookieFile()}
              showAdvanced
              pluginDirectory={engines?.poTokenPluginsDir}
              onRepairNativeBridge={() => void repairNativeBridge()}
              bridgeRepairing={bridgeRepairing}
            />
            <ExtensionSetup appVersion={LIPIT_VERSION} onError={setDialogError} />
            <StatsPanel
              refreshKey={statsKey}
              onError={setDialogError}
              onResetRequest={(reset) =>
                setConfirm({
                  title: "İstatistikler sıfırlansın mı?",
                  message: "Yerel sayaçlar sıfırlanır. Geçmiş ve dosyalar etkilenmez.",
                  confirmLabel: "Sıfırla",
                  destructive: true,
                  onConfirm: reset,
                })
              }
            />
            {settingsMessage && <p className="settings-message">{settingsMessage}</p>}
            {dialogError && <p className="settings-inline-error" role="alert">{dialogError}</p>}
          </div>
          <div className="settings-modal-footer">
            <button className="settings-cancel-button" type="button" onClick={() => void copyDiagnostics()}>
              <Clipboard size={16} /> Tanılamayı kopyala
            </button>
            <button className="settings-cancel-button" type="button" onClick={() => setSettingsOpen(false)}>
              Vazgeç
            </button>
            <button className="primary-button" type="button" onClick={() => void saveAppSettings(false)} disabled={settingsSaving}>
              {settingsSaving ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}
              {settingsSaving ? "Kaydediliyor" : "Ayarları kaydet"}
            </button>
          </div>
        </Dialog>
      )}

      {historyOpen && (
        <HistoryDialog
          history={history}
          previewLoading={previewLoading}
          actions={historyActions}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {preview && (
        <Dialog className="preview-modal" label="Video önizlemesi" onClose={() => setPreview(null)}>
          <div className="modal-head">
            <span className="side-icon history-icon"><ListVideo size={18} /></span>
            <div>
              <h2>{preview.title}</h2>
              <p>{preview.subtitle}</p>
            </div>
            <button type="button" onClick={() => setPreview(null)} aria-label="Önizlemeyi kapat"><X size={18} /></button>
          </div>
          <video src={preview.source} controls autoPlay preload="metadata" />
          <div className="preview-meta">
            <span>Yerel MP4 önizlemesi</span>
            <code title={preview.path}>{preview.path}</code>
          </div>
        </Dialog>
      )}

      {shortcutsOpen && (
        <Dialog className="shortcut-modal" label="Klavye kısayolları" onClose={() => setShortcutsOpen(false)}>
          <div className="modal-head">
            <span className="side-icon"><Keyboard size={18} /></span>
            <div><h2>Klavye kısayolları</h2><p>Fare kullanmadan hızlı kontrol</p></div>
            <button type="button" onClick={() => setShortcutsOpen(false)} aria-label="Kapat"><X size={18} /></button>
          </div>
          <div className="shortcut-list">
            <div><span>Bağlantı alanına git</span><kbd>Ctrl</kbd><kbd>L</kbd></div>
            <div><span>Videoyu getir</span><kbd>Ctrl</kbd><kbd>Enter</kbd></div>
            <div><span>Tamamını indir</span><kbd>Ctrl</kbd><kbd>1</kbd></div>
            <div><span>Klip oluştur</span><kbd>Ctrl</kbd><kbd>2</kbd></div>
            <div><span>Bu pencereyi aç</span><kbd>?</kbd></div>
            <div><span>Pencereyi kapat</span><kbd>Esc</kbd></div>
          </div>
        </Dialog>
      )}

      {aboutOpen && (
        <AboutDialog
          version={LIPIT_VERSION}
          displayVersion={LIPIT_DISPLAY_VERSION}
          onClose={() => setAboutOpen(false)}
        />
      )}

      {confirm && <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />}

      <footer className="footer">
        <span>Lipit Capture · {LIPIT_DISPLAY_VERSION.toLowerCase()}</span>
        <span className={engines && !enginesReady ? "footer-warning" : ""}>{engineSummary}</span>
      </footer>
    </div>
  );
}
