use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use url::Url;

use crate::{
    clip::ClipSpec,
    log,
    models::{AppError, DownloadRequest, HistoryEntry, JobKind},
    settings,
};

const HISTORY_FILE: &str = "history.json";
const HISTORY_SCHEMA_VERSION: u32 = 2;
const MAX_HISTORY_ENTRIES: usize = 200;
const MAX_HISTORY_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HistoryFile {
    schema_version: u32,
    entries: Vec<HistoryEntry>,
}

pub fn record_completed(
    app: &AppHandle,
    id: &str,
    request: &DownloadRequest,
    clip: Option<ClipSpec>,
    destination: &Path,
) -> Result<(), AppError> {
    let metadata = fs::metadata(destination)
        .map_err(|_| AppError::new("HISTORY_UNAVAILABLE", "Çıktı bilgisi okunamadı."))?;
    let title = destination
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Video")
        .to_owned();
    let source_host = Url::parse(&request.url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
        .unwrap_or_else(|| "Yerel medya".into());
    let entry = HistoryEntry {
        id: id.to_owned(),
        kind: if clip.is_some() {
            JobKind::Clip
        } else {
            JobKind::Download
        },
        title,
        source_host,
        output_path: destination.to_string_lossy().into_owned(),
        completed_at_ms: now_ms(),
        size_bytes: metadata.len(),
        file_exists: true,
        quality_height: request.quality_height,
        start_ms: clip.map(|value| value.start_ms),
        end_ms: clip.map(|value| value.end_ms),
        clip_mode: clip.map(|value| value.mode),
    };
    let mut entries = load_file(app)?;
    entries.retain(|current| current.id != entry.id && current.output_path != entry.output_path);
    entries.insert(0, entry);
    for removed in entries.iter().skip(MAX_HISTORY_ENTRIES) {
        remove_thumbnail(app, &removed.id);
    }
    entries.truncate(MAX_HISTORY_ENTRIES);
    save_file(app, &entries)
}

pub fn list(app: &AppHandle) -> Result<Vec<HistoryEntry>, AppError> {
    let mut entries = load_file(app)?;
    for entry in &mut entries {
        let path = Path::new(&entry.output_path);
        entry.file_exists = path.is_file();
        if let Ok(metadata) = fs::metadata(path) {
            entry.size_bytes = metadata.len();
        }
    }
    Ok(entries)
}

pub fn clear(app: &AppHandle) -> Result<(), AppError> {
    if let Ok(directory) = thumbnail_dir(app) {
        let _ = fs::remove_dir_all(directory);
    }
    save_file(app, &[])
}

pub fn delete(app: &AppHandle, history_id: &str) -> Result<(), AppError> {
    let mut entries = load_file(app)?;
    let before = entries.len();
    entries.retain(|entry| entry.id != history_id);
    if entries.len() == before {
        return Err(AppError::new(
            "HISTORY_NOT_FOUND",
            "Geçmiş kaydı bulunamadı.",
        ));
    }
    remove_thumbnail(app, history_id);
    save_file(app, &entries)
}

pub fn find(app: &AppHandle, history_id: &str) -> Result<HistoryEntry, AppError> {
    load_file(app)?
        .into_iter()
        .find(|entry| entry.id == history_id)
        .ok_or_else(|| AppError::new("HISTORY_NOT_FOUND", "Geçmiş kaydı bulunamadı."))
}

/// Opens an existing MP4 output for playback through the asset protocol.
pub fn authorize_preview(app: &AppHandle, history_id: &str) -> Result<String, AppError> {
    let path = PathBuf::from(find(app, history_id)?.output_path);
    if !path.is_absolute()
        || !path.is_file()
        || path
            .extension()
            .and_then(|value| value.to_str())
            .is_none_or(|value| !value.eq_ignore_ascii_case("mp4"))
    {
        return Err(AppError::new(
            "PREVIEW_UNAVAILABLE",
            "Önizleme dosyası artık mevcut değil.",
        ));
    }
    authorize_asset(app, &path)
}

pub fn authorize_asset(app: &AppHandle, path: &Path) -> Result<String, AppError> {
    let canonical = fs::canonicalize(path)
        .map_err(|_| AppError::new("PREVIEW_UNAVAILABLE", "Dosya açılamadı."))?;
    app.asset_protocol_scope()
        .allow_file(&canonical)
        .map_err(|_| AppError::new("PREVIEW_UNAVAILABLE", "Dosya önizlemeye açılamadı."))?;
    Ok(path.to_string_lossy().into_owned())
}

pub fn thumbnail_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("thumbnails"))
        .map_err(|_| AppError::new("HISTORY_UNAVAILABLE", "Küçük resim klasörü bulunamadı."))
}

pub fn thumbnail_path(app: &AppHandle, history_id: &str) -> Result<PathBuf, AppError> {
    if history_id.is_empty()
        || history_id.len() > 64
        || !history_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err(AppError::new(
            "HISTORY_NOT_FOUND",
            "Geçmiş kaydı bulunamadı.",
        ));
    }
    Ok(thumbnail_dir(app)?.join(format!("{history_id}.jpg")))
}

/// Returns a displayable path for a stored thumbnail, if one exists.
pub fn authorize_thumbnail(app: &AppHandle, history_id: &str) -> Result<Option<String>, AppError> {
    let path = thumbnail_path(app, history_id)?;
    if !path.is_file() {
        return Ok(None);
    }
    authorize_asset(app, &path).map(Some)
}

fn remove_thumbnail(app: &AppHandle, history_id: &str) {
    if let Ok(path) = thumbnail_path(app, history_id) {
        let _ = fs::remove_file(path);
    }
}

fn load_file(app: &AppHandle) -> Result<Vec<HistoryEntry>, AppError> {
    let path = history_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let metadata = fs::metadata(&path)
        .map_err(|_| AppError::new("HISTORY_UNAVAILABLE", "Geçmiş okunamadı."))?;
    let parsed = if metadata.len() > MAX_HISTORY_BYTES {
        None
    } else {
        let bytes = fs::read(&path)
            .map_err(|_| AppError::new("HISTORY_UNAVAILABLE", "Geçmiş okunamadı."))?;
        parse(&bytes)
    };
    match parsed {
        Some(mut entries) => {
            entries.truncate(MAX_HISTORY_ENTRIES);
            Ok(entries)
        }
        None => {
            settings::quarantine(&path, "Geçmiş");
            Ok(Vec::new())
        }
    }
}

/// Reads both the current object format and the legacy (v1) bare array.
fn parse(bytes: &[u8]) -> Option<Vec<HistoryEntry>> {
    let value: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    if value.is_array() {
        return serde_json::from_value(value).ok();
    }
    let file: HistoryFile = serde_json::from_value(value).ok()?;
    (file.schema_version <= HISTORY_SCHEMA_VERSION).then_some(file.entries)
}

fn save_file(app: &AppHandle, entries: &[HistoryEntry]) -> Result<(), AppError> {
    let path = history_path(app)?;
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new("HISTORY_UNAVAILABLE", "Geçmiş klasörü bulunamadı."))?;
    fs::create_dir_all(parent)
        .map_err(|_| AppError::new("HISTORY_UNAVAILABLE", "Geçmiş klasörü oluşturulamadı."))?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|_| AppError::new("HISTORY_UNAVAILABLE", "Geçmiş kaydedilemedi."))?;
    let file = HistoryFile {
        schema_version: HISTORY_SCHEMA_VERSION,
        entries: entries.to_vec(),
    };
    serde_json::to_writer_pretty(&mut temporary, &file)
        .map_err(|_| AppError::new("HISTORY_UNAVAILABLE", "Geçmiş kaydedilemedi."))?;
    temporary
        .flush()
        .and_then(|()| temporary.as_file().sync_all())
        .map_err(|_| AppError::new("HISTORY_UNAVAILABLE", "Geçmiş kaydedilemedi."))?;
    temporary.persist(path).map_err(|_| {
        log::error("Geçmiş dosyası kaydedilemedi.");
        AppError::new("HISTORY_UNAVAILABLE", "Geçmiş kaydedilemedi.")
    })?;
    Ok(())
}

fn history_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_config_dir()
        .map(|path| path.join(HISTORY_FILE))
        .map_err(|_| AppError::new("HISTORY_UNAVAILABLE", "Geçmiş klasörü bulunamadı."))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::parse;

    const ENTRY: &str = r#"{"id":"a","kind":"clip","title":"t","sourceHost":"h","outputPath":"C:\\v.mp4","completedAtMs":1,"sizeBytes":2,"fileExists":true,"qualityHeight":null,"startMs":0,"endMs":1000,"clipMode":"fast"}"#;

    #[test]
    fn reads_legacy_and_current_history_formats() {
        let legacy = format!("[{ENTRY}]");
        assert_eq!(parse(legacy.as_bytes()).unwrap().len(), 1);
        let current = format!(r#"{{"schemaVersion":2,"entries":[{ENTRY}]}}"#);
        assert_eq!(parse(current.as_bytes()).unwrap().len(), 1);
        assert!(parse(br#"{"schemaVersion":99,"entries":[]}"#).is_none());
        assert!(parse(b"garbage").is_none());
    }
}
