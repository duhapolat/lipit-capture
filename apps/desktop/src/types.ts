// Shapes exchanged with the Rust backend (see src-tauri/src/models.rs).

export type AppError = { code: string; message: string };

export type RequestContext = {
  referer: string | null;
  origin: string | null;
  userAgent: string | null;
};

export type QualityProfile = {
  height: number | null;
  label: string;
  fps: number | null;
};

export type PreviewSource = {
  url: string;
  requestContext: RequestContext;
};

export type ResolvedMedia = {
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
  preview: PreviewSource | null;
};

export type JobStatus =
  | "queued"
  | "resolving"
  | "downloading"
  | "analyzing"
  | "encoding"
  | "saving"
  | "completed"
  | "failed"
  | "cancelled";

export type JobKind = "download" | "clip";
export type ClipMode = "fast" | "precise";

export type DownloadJob = {
  id: string;
  kind: JobKind;
  sourceUrl: string;
  qualityHeight: number | null;
  startMs: number | null;
  endMs: number | null;
  clipMode: ClipMode | null;
  outputPath: string;
  status: JobStatus;
  progressPercent: number | null;
  speedBytesPerSecond: number | null;
  etaSeconds: number | null;
  error: AppError | null;
};

export type EngineVersions = {
  ytDlp: string | null;
  ffmpeg: string | null;
  ffprobe: string | null;
  deno: string | null;
  ytDlpManaged: boolean;
  ejs: string;
  poTokenPluginsDir: string;
};

export type CookieBrowser = "brave" | "chrome" | "edge" | "file";
export type FilenameTemplate = "title_date" | "title" | "source_title_date";

export type AppSettings = {
  schemaVersion: number;
  onboardingCompleted: boolean;
  termsAccepted: boolean;
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
    cookieFile: string | null;
    remoteEjsEnabled: boolean;
    poTokenProvidersEnabled: boolean;
  };
  filenameTemplate: FilenameTemplate;
  updateChecksEnabled: boolean;
};

export type EngineUpdateResult = {
  previousVersion: string | null;
  currentVersion: string;
  updated: boolean;
};

export type NativeBridgeRepairResult = {
  hostPath: string;
  manifestPath: string;
  browsersRegistered: number;
};

export type ExtensionStatus = {
  extensionFolder: string | null;
  hostRegistered: boolean;
  lastSeenMs: number | null;
  extensionVersion: string | null;
};

export type HistoryEntry = {
  id: string;
  kind: JobKind;
  title: string;
  sourceHost: string;
  outputPath: string;
  completedAtMs: number;
  sizeBytes: number;
  fileExists: boolean;
  qualityHeight: number | null;
  startMs: number | null;
  endMs: number | null;
  clipMode: ClipMode | null;
};

export type Stats = {
  sinceMs: number;
  completed: number;
  failed: number;
  cancelled: number;
  quickStarted: number;
  quickCompleted: number;
  quickFailed: number;
  errorCodes: Record<string, number>;
  sourceHosts: Record<string, number>;
};

export type CaptureAction = "download" | "clip" | "quick_download" | "quick_clip";

export type MediaCandidate = {
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

export type StoredCandidate = {
  action: CaptureAction;
  candidate: MediaCandidate;
  receivedAtMs: number;
};

/** What the UI needs to start (or retry) a job. */
export type JobPlan = {
  kind: JobKind;
  media: ResolvedMedia;
  qualityHeight: number | null;
  range: { startMs: number; endMs: number } | null;
  clipMode: ClipMode;
};
