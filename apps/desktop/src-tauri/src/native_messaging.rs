use std::{
    env,
    fs::{self, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::models::AppError;
use crate::url_safety;

pub const PROTOCOL_VERSION: u16 = 1;
const MAX_MESSAGE_BYTES: usize = 1024 * 1024;
const MAX_STORED_CANDIDATE_BYTES: u64 = 256 * 1024;
const APP_IDENTIFIER: &str = "com.lipit.capture";

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CandidateSource {
    Dom,
    Network,
    Extractor,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaProtocol {
    Http,
    Hls,
    Dash,
    Blob,
    Unknown,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CaptureAction {
    Download,
    Clip,
    QuickDownload,
    QuickClip,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MediaCandidate {
    pub id: String,
    pub tab_id: u64,
    pub page_url: String,
    pub page_title: Option<String>,
    pub media_url: Option<String>,
    pub source: CandidateSource,
    pub protocol: MediaProtocol,
    pub mime_type: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
    pub duration_ms: Option<u64>,
    pub current_time_ms: Option<u64>,
    pub referer: Option<String>,
    pub origin: Option<String>,
    pub user_agent: Option<String>,
    #[serde(default)]
    pub drm: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoredCandidate {
    pub action: CaptureAction,
    pub candidate: MediaCandidate,
    pub received_at_ms: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeRequest {
    protocol_version: u16,
    #[serde(rename = "type")]
    kind: String,
    action: Option<CaptureAction>,
    candidate: Option<MediaCandidate>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeResponse {
    protocol_version: u16,
    #[serde(rename = "type")]
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    candidate_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<NativeError>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeError {
    code: String,
    message: String,
}

pub fn validate_candidate(candidate: &MediaCandidate) -> Result<(), AppError> {
    if candidate.id.is_empty()
        || candidate.id.len() > 128
        || !candidate
            .id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(AppError::new("INVALID_CANDIDATE", "Medya adayı geçersiz."));
    }
    validate_http_url(&candidate.page_url, 4096)?;
    if let Some(media_url) = candidate.media_url.as_deref() {
        validate_http_url(media_url, 8192)?;
    }
    validate_text(candidate.page_title.as_deref(), 512)?;
    validate_text(candidate.mime_type.as_deref(), 128)?;
    validate_text(candidate.referer.as_deref(), 4096)?;
    validate_text(candidate.origin.as_deref(), 512)?;
    validate_text(candidate.user_agent.as_deref(), 1024)?;
    if candidate.width.is_some_and(|value| value > 32_768)
        || candidate.height.is_some_and(|value| value > 32_768)
        || candidate
            .duration_ms
            .is_some_and(|value| value == 0 || value > 7 * 24 * 60 * 60 * 1000)
        || candidate
            .current_time_ms
            .is_some_and(|value| value > 7 * 24 * 60 * 60 * 1000)
        || candidate
            .fps
            .is_some_and(|value| !value.is_finite() || !(0.0..=1000.0).contains(&value))
    {
        return Err(AppError::new(
            "INVALID_CANDIDATE",
            "Medya bilgileri geçersiz.",
        ));
    }
    if candidate.drm {
        return Err(AppError::new(
            "DRM_PROTECTED",
            "DRM protected — download unavailable",
        ));
    }
    Ok(())
}

fn validate_http_url(raw: &str, max_len: usize) -> Result<(), AppError> {
    url_safety::validate_public_http_url(raw, max_len).map(|_| ())
}

fn validate_text(value: Option<&str>, max_len: usize) -> Result<(), AppError> {
    if value.is_some_and(|text| text.len() > max_len || text.contains('\0')) {
        Err(AppError::new(
            "INVALID_CANDIDATE",
            "Medya bilgileri çok uzun.",
        ))
    } else {
        Ok(())
    }
}

fn inbox_dir() -> Result<PathBuf, AppError> {
    let base = env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| env::var_os("LOCALAPPDATA").map(PathBuf::from))
        .ok_or_else(|| {
            AppError::new(
                "NATIVE_BRIDGE_UNAVAILABLE",
                "Tarayıcı bağlantı klasörü bulunamadı.",
            )
        })?;
    Ok(base
        .join(APP_IDENTIFIER)
        .join("native-messaging")
        .join("inbox"))
}

fn store_candidate(candidate: &StoredCandidate) -> Result<(), AppError> {
    let inbox = inbox_dir()?;
    fs::create_dir_all(&inbox).map_err(|_| {
        AppError::new(
            "NATIVE_BRIDGE_UNAVAILABLE",
            "Tarayıcı bağlantı klasörü oluşturulamadı.",
        )
    })?;
    let id = Uuid::new_v4().to_string();
    let temporary = inbox.join(format!(".{id}.tmp"));
    let destination = inbox.join(format!("{id}.json"));
    let bytes = serde_json::to_vec(candidate)
        .map_err(|_| AppError::new("INVALID_MESSAGE", "Mesaj kaydedilemedi."))?;
    if bytes.len() > MAX_STORED_CANDIDATE_BYTES as usize {
        return Err(AppError::new("MESSAGE_TOO_LARGE", "Mesaj çok büyük."));
    }
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|_| AppError::new("NATIVE_BRIDGE_UNAVAILABLE", "Mesaj kaydedilemedi."))?;
    if file
        .write_all(&bytes)
        .and_then(|()| file.sync_all())
        .is_err()
    {
        let _ = fs::remove_file(&temporary);
        return Err(AppError::new(
            "NATIVE_BRIDGE_UNAVAILABLE",
            "Mesaj kaydedilemedi.",
        ));
    }
    fs::rename(&temporary, &destination).map_err(|_| {
        let _ = fs::remove_file(&temporary);
        AppError::new("NATIVE_BRIDGE_UNAVAILABLE", "Mesaj kaydedilemedi.")
    })
}

pub fn drain_candidates() -> Result<Vec<StoredCandidate>, AppError> {
    let inbox = inbox_dir()?;
    if !inbox.exists() {
        return Ok(Vec::new());
    }
    let mut paths: Vec<PathBuf> = fs::read_dir(&inbox)
        .map_err(|_| AppError::new("NATIVE_BRIDGE_UNAVAILABLE", "Tarayıcı mesajları okunamadı."))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("json"))
        .take(100)
        .collect();
    paths.sort();

    let mut candidates = Vec::new();
    for path in paths {
        let value = read_candidate_file(&path);
        let _ = fs::remove_file(&path);
        if let Ok(candidate) = value {
            candidates.push(candidate);
        }
    }
    candidates.sort_by_key(|candidate| candidate.received_at_ms);
    Ok(candidates)
}

pub fn cleanup_stale_files() {
    let Ok(inbox) = inbox_dir() else { return };
    let Ok(entries) = fs::read_dir(inbox) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        let extension = path.extension().and_then(|value| value.to_str());
        let max_age = match extension {
            Some("tmp") => 60 * 60,
            Some("json") => 7 * 24 * 60 * 60,
            _ => continue,
        };
        let is_stale = entry
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|modified| modified.elapsed().ok())
            .is_some_and(|age| age.as_secs() > max_age);
        if is_stale {
            let _ = fs::remove_file(path);
        }
    }
}

fn read_candidate_file(path: &Path) -> Result<StoredCandidate, AppError> {
    let metadata = fs::metadata(path)
        .map_err(|_| AppError::new("INVALID_MESSAGE", "Tarayıcı mesajı okunamadı."))?;
    if !metadata.is_file() || metadata.len() > MAX_STORED_CANDIDATE_BYTES {
        return Err(AppError::new(
            "MESSAGE_TOO_LARGE",
            "Tarayıcı mesajı çok büyük.",
        ));
    }
    let bytes = fs::read(path)
        .map_err(|_| AppError::new("INVALID_MESSAGE", "Tarayıcı mesajı okunamadı."))?;
    let stored: StoredCandidate = serde_json::from_slice(&bytes)
        .map_err(|_| AppError::new("INVALID_MESSAGE", "Tarayıcı mesajı geçersiz."))?;
    validate_candidate(&stored.candidate)?;
    Ok(stored)
}

pub fn run_stdio_host() -> io::Result<()> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut input = stdin.lock();
    let mut output = stdout.lock();
    loop {
        let mut length = [0_u8; 4];
        match input.read_exact(&mut length) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(()),
            Err(error) => return Err(error),
        }
        let size = u32::from_le_bytes(length) as usize;
        if size == 0 || size > MAX_MESSAGE_BYTES {
            write_response(
                &mut output,
                &error_response("MESSAGE_TOO_LARGE", "Mesaj boyutu kabul edilmedi."),
            )?;
            if size > MAX_MESSAGE_BYTES {
                return Ok(());
            }
            continue;
        }
        let mut payload = vec![0_u8; size];
        input.read_exact(&mut payload)?;
        let response = handle_payload(&payload);
        write_response(&mut output, &response)?;
    }
}

fn handle_payload(payload: &[u8]) -> NativeResponse {
    let request: NativeRequest = match serde_json::from_slice(payload) {
        Ok(request) => request,
        Err(_) => return error_response("INVALID_MESSAGE", "Mesaj şeması geçersiz."),
    };
    if request.protocol_version != PROTOCOL_VERSION {
        return error_response("UNSUPPORTED_PROTOCOL", "Protokol sürümü desteklenmiyor.");
    }
    match request.kind.as_str() {
        "PING" if request.action.is_none() && request.candidate.is_none() => NativeResponse {
            protocol_version: PROTOCOL_VERSION,
            kind: "PONG".into(),
            candidate_id: None,
            error: None,
        },
        "MEDIA_DETECTED" => {
            let (Some(action), Some(candidate)) = (request.action, request.candidate) else {
                return error_response("INVALID_MESSAGE", "Medya adayı eksik.");
            };
            if let Err(error) = validate_candidate(&candidate) {
                return error_response(error.code, &error.message);
            }
            let candidate_id = candidate.id.clone();
            let quick = matches!(
                action,
                CaptureAction::QuickDownload | CaptureAction::QuickClip
            );
            let stored = StoredCandidate {
                action,
                candidate,
                received_at_ms: now_ms(),
            };
            if let Err(error) = store_candidate(&stored) {
                return error_response(error.code, &error.message);
            }
            let _ = launch_desktop_if_needed(quick);
            NativeResponse {
                protocol_version: PROTOCOL_VERSION,
                kind: "MEDIA_ACCEPTED".into(),
                candidate_id: Some(candidate_id),
                error: None,
            }
        }
        _ => error_response("UNKNOWN_COMMAND", "Bilinmeyen komut reddedildi."),
    }
}

fn error_response(code: &str, message: &str) -> NativeResponse {
    NativeResponse {
        protocol_version: PROTOCOL_VERSION,
        kind: "ERROR".into(),
        candidate_id: None,
        error: Some(NativeError {
            code: code.into(),
            message: message.into(),
        }),
    }
}

fn write_response(output: &mut impl Write, response: &NativeResponse) -> io::Result<()> {
    let payload = serde_json::to_vec(response)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let length = u32::try_from(payload.len())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "response too large"))?;
    output.write_all(&length.to_le_bytes())?;
    output.write_all(&payload)?;
    output.flush()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn launch_desktop_if_needed(quick: bool) -> io::Result<()> {
    if desktop_is_running() {
        return Ok(());
    }
    let current = env::current_exe()?;
    let executable_name = if cfg!(windows) {
        "lipit-desktop.exe"
    } else {
        "lipit-desktop"
    };
    let parent = current.parent().unwrap_or_else(|| Path::new("."));
    let sibling = parent.join(executable_name);
    // Development builds keep both executables together. Windows installers
    // place the native host in the resources directory one level below the app.
    let desktop = if sibling.is_file() {
        sibling
    } else {
        parent
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(executable_name)
    };
    if !desktop.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "desktop executable not found",
        ));
    }
    let mut command = Command::new(desktop);
    if quick {
        command.arg("--quick-background");
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0000_0008 | 0x0000_0200);
    }
    command.spawn().map(|_| ())
}

#[cfg(windows)]
fn desktop_is_running() -> bool {
    Command::new("tasklist.exe")
        .args(["/FI", "IMAGENAME eq lipit-desktop.exe", "/FO", "CSV", "/NH"])
        .output()
        .ok()
        .is_some_and(|output| {
            String::from_utf8_lossy(&output.stdout)
                .to_ascii_lowercase()
                .contains("lipit-desktop.exe")
        })
}

#[cfg(not(windows))]
fn desktop_is_running() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate() -> MediaCandidate {
        MediaCandidate {
            id: "9f184e11-9225-45d3-9ed5-c3a73149947d".into(),
            tab_id: 1,
            page_url: "https://example.com/watch".into(),
            page_title: Some("Example".into()),
            media_url: Some("https://cdn.example.com/video.mp4".into()),
            source: CandidateSource::Dom,
            protocol: MediaProtocol::Http,
            mime_type: Some("video/mp4".into()),
            width: Some(1920),
            height: Some(1080),
            fps: None,
            duration_ms: Some(10_000),
            current_time_ms: Some(2_500),
            referer: None,
            origin: None,
            user_agent: None,
            drm: false,
        }
    }

    #[test]
    fn validates_safe_candidate() {
        assert!(validate_candidate(&candidate()).is_ok());
    }

    #[test]
    fn rejects_drm_candidate() {
        let mut value = candidate();
        value.drm = true;
        assert_eq!(
            validate_candidate(&value).unwrap_err().code,
            "DRM_PROTECTED"
        );
    }

    #[test]
    fn rejects_non_http_media_url() {
        let mut value = candidate();
        value.media_url = Some("file:///c:/secret.mp4".into());
        assert_eq!(validate_candidate(&value).unwrap_err().code, "INVALID_URL");
    }

    #[test]
    fn rejects_zero_duration_candidate() {
        let mut value = candidate();
        value.duration_ms = Some(0);
        assert_eq!(
            validate_candidate(&value).unwrap_err().code,
            "INVALID_CANDIDATE"
        );
    }
}
