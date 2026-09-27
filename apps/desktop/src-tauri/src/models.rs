use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: &'static str,
    pub message: String,
}

impl AppError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineVersions {
    pub yt_dlp: Option<String>,
    pub ffmpeg: Option<String>,
    pub ffprobe: Option<String>,
    pub deno: Option<String>,
    pub yt_dlp_managed: bool,
    pub ejs: String,
    pub po_token_plugins_dir: String,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RequestContext {
    pub referer: Option<String>,
    pub origin: Option<String>,
    pub user_agent: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityProfile {
    pub height: Option<u32>,
    pub label: String,
    pub fps: Option<f64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedMedia {
    pub url: String,
    pub title: String,
    pub uploader: Option<String>,
    pub duration_ms: Option<u64>,
    pub thumbnail: Option<String>,
    pub profiles: Vec<QualityProfile>,
    pub drm: bool,
    pub direct: bool,
    pub is_live: bool,
    pub refresh_url: Option<String>,
    pub request_context: RequestContext,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DownloadRequest {
    pub url: String,
    pub quality_height: Option<u32>,
    pub output_path: String,
    #[serde(default)]
    pub direct: bool,
    #[serde(default)]
    pub refresh_url: Option<String>,
    #[serde(default)]
    pub known_duration_ms: Option<u64>,
    #[serde(default)]
    pub request_context: RequestContext,
}

#[derive(Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ClipMode {
    #[default]
    Fast,
    Precise,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClipRequest {
    pub url: String,
    pub quality_height: Option<u32>,
    pub output_path: String,
    #[serde(default)]
    pub direct: bool,
    #[serde(default)]
    pub refresh_url: Option<String>,
    pub start_ms: u64,
    pub end_ms: u64,
    pub mode: ClipMode,
    #[serde(default)]
    pub known_duration_ms: Option<u64>,
    #[serde(default)]
    pub request_context: RequestContext,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CookieBrowser {
    Brave,
    Chrome,
    Edge,
}

impl CookieBrowser {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Brave => "brave",
            Self::Chrome => "chrome",
            Self::Edge => "edge",
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompatibilitySettings {
    pub cookies_enabled: bool,
    pub cookie_browser: CookieBrowser,
    pub remote_ejs_enabled: bool,
    pub po_token_providers_enabled: bool,
}

impl Default for CompatibilitySettings {
    fn default() -> Self {
        Self {
            cookies_enabled: false,
            cookie_browser: CookieBrowser::Chrome,
            remote_ejs_enabled: false,
            po_token_providers_enabled: false,
        }
    }
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppSettings {
    #[serde(default)]
    pub onboarding_completed: bool,
    #[serde(default)]
    pub quick_profile: QuickProfileSettings,
    #[serde(default)]
    pub compatibility: CompatibilitySettings,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DestinationMode {
    Ask,
    Folder,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuickProfileSettings {
    pub destination_mode: DestinationMode,
    pub download_directory: Option<String>,
    pub clip_duration_ms: u64,
    #[serde(default)]
    pub quality_height: Option<u32>,
    #[serde(default)]
    pub clip_mode: ClipMode,
}

impl Default for QuickProfileSettings {
    fn default() -> Self {
        Self {
            destination_mode: DestinationMode::Ask,
            download_directory: None,
            clip_duration_ms: 30_000,
            quality_height: None,
            clip_mode: ClipMode::Fast,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineUpdateResult {
    pub previous_version: Option<String>,
    pub current_version: String,
    pub updated: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryEntry {
    pub id: String,
    pub kind: JobKind,
    pub title: String,
    pub source_host: String,
    pub output_path: String,
    pub completed_at_ms: u64,
    pub size_bytes: u64,
    #[serde(default)]
    pub file_exists: bool,
    pub quality_height: Option<u32>,
    pub start_ms: Option<u64>,
    pub end_ms: Option<u64>,
    pub clip_mode: Option<ClipMode>,
}

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum JobKind {
    Download,
    Clip,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Queued,
    Resolving,
    Downloading,
    Analyzing,
    Encoding,
    Saving,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadJob {
    pub id: String,
    pub kind: JobKind,
    pub source_url: String,
    pub quality_height: Option<u32>,
    pub start_ms: Option<u64>,
    pub end_ms: Option<u64>,
    pub clip_mode: Option<ClipMode>,
    pub output_path: String,
    pub status: JobStatus,
    pub progress_percent: Option<f64>,
    pub speed_bytes_per_second: Option<f64>,
    pub eta_seconds: Option<u64>,
    pub error: Option<AppError>,
}
