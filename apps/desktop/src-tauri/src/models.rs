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
    /// A low-resolution stream used only to render preview frames locally.
    pub preview: Option<PreviewSource>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewSource {
    pub url: String,
    #[serde(default)]
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
    /// Pick a free `name_N.mp4` when the destination exists at save time.
    #[serde(default)]
    pub auto_rename: bool,
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
    #[serde(default)]
    pub auto_rename: bool,
}

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CookieBrowser {
    Brave,
    Chrome,
    Edge,
    /// A Netscape `cookies.txt` file chosen by the user.
    File,
}

impl CookieBrowser {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Brave => "brave",
            Self::Chrome => "chrome",
            Self::Edge => "edge",
            Self::File => "file",
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompatibilitySettings {
    pub cookies_enabled: bool,
    pub cookie_browser: CookieBrowser,
    #[serde(default)]
    pub cookie_file: Option<String>,
    pub remote_ejs_enabled: bool,
    pub po_token_providers_enabled: bool,
}

impl Default for CompatibilitySettings {
    fn default() -> Self {
        Self {
            cookies_enabled: false,
            cookie_browser: CookieBrowser::Chrome,
            cookie_file: None,
            remote_ejs_enabled: false,
            po_token_providers_enabled: false,
        }
    }
}

pub const SETTINGS_SCHEMA_VERSION: u32 = 2;

fn settings_schema_version() -> u32 {
    SETTINGS_SCHEMA_VERSION
}

fn enabled() -> bool {
    true
}

#[derive(Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum FilenameTemplate {
    #[default]
    TitleDate,
    Title,
    SourceTitleDate,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppSettings {
    #[serde(default = "settings_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub onboarding_completed: bool,
    /// The user confirmed the usage terms (only content they are entitled to).
    #[serde(default)]
    pub terms_accepted: bool,
    #[serde(default)]
    pub quick_profile: QuickProfileSettings,
    #[serde(default)]
    pub compatibility: CompatibilitySettings,
    #[serde(default)]
    pub filename_template: FilenameTemplate,
    /// Once a day, ask the public release pages whether a newer Lipit or
    /// media engine exists. Nothing is downloaded without confirmation.
    #[serde(default = "enabled")]
    pub update_checks_enabled: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: SETTINGS_SCHEMA_VERSION,
            onboarding_completed: false,
            terms_accepted: false,
            quick_profile: QuickProfileSettings::default(),
            compatibility: CompatibilitySettings::default(),
            filename_template: FilenameTemplate::default(),
            update_checks_enabled: true,
        }
    }
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

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Debug)]
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
